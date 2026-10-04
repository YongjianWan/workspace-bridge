// @semantic — Independent file and Git change sets for platform edge cases.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-platform-truth-'));
if (path.dirname(path.resolve(scratch)) !== path.resolve(os.tmpdir())) throw new Error('Unsafe scratch path');
const cacheRoot = path.join(scratch, 'cache');
const report = {};

function git(cwd, args) {
  const result = spawnSync('git', ['-c', 'user.name=ValidationFixture',
    '-c', 'user.email=validation@example.invalid', ...args], { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}
function cli(command, cwd, args = []) {
  const result = spawnSync(process.execPath, [path.join(root, 'cli.js'), command,
    '--cwd', cwd, ...args, '--json', '--quiet'], {
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 120000,
    env: { ...process.env, WB_CACHE_DIR: cacheRoot },
  });
  if (result.error) throw result.error;
  return { exitCode: result.status, data: JSON.parse(result.stdout.replace(/^\uFEFF/, '')) };
}
function makeRepo(name) {
  const dir = path.join(scratch, name);
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'main.js'), "const helper = require('./helper'); module.exports = helper;\n");
  fs.writeFileSync(path.join(dir, 'src', 'helper.js'), 'module.exports = 1;\n');
  return dir;
}
function coverage(data) {
  return data.summary?.analysisCoverage || data.analysisCoverage || null;
}
function databases(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? databases(file)
      : entry.name === 'cache.db' ? [{ file: path.relative(cacheRoot, file), bytes: fs.statSync(file).size }] : [];
  });
}
function removeInsideScratch(target) {
  const absolute = path.resolve(target);
  if (!absolute.startsWith(path.resolve(scratch) + path.sep)) throw new Error(`Unsafe path ${target}`);
  fs.rmSync(absolute, { recursive: true, force: true });
}

try {
  const loopRepo = makeRepo('junction');
  try {
    fs.symlinkSync(path.join(loopRepo, 'src'), path.join(loopRepo, 'src', 'loop'),
      process.platform === 'win32' ? 'junction' : 'dir');
    const { data, exitCode } = cli('audit-overview', loopRepo);
    report.junction = { expectedFiles: 2, coverage: coverage(data), exitCode,
      warnings: data.warnings, correct: data.ok && coverage(data)?.totalFiles === 2 };
  } catch (error) { report.junction = { setupError: error.message }; }

  const slashRepo = makeRepo('backslash');
  const backslash = cli('impact', slashRepo, ['--file', 'src\\helper.js']);
  report.backslash = { expectedCount: 1, actualCount: backslash.data.impactCount,
    files: (backslash.data.impact || []).map((item) => path.relative(slashRepo, item.file)),
    correct: backslash.data.ok && backslash.data.impactCount === 1 };
  if (process.platform === 'win32') {
    git(slashRepo, ['init', '-b', 'main']);
    git(slashRepo, ['add', '.']);
    git(slashRepo, ['commit', '-m', 'UNC验证基线']);
    fs.writeFileSync(path.join(slashRepo, 'src', 'helper.js'), 'module.exports = 9;\n');
    const unc = `\\\\localhost\\${slashRepo[0]}$\\${slashRepo.slice(3)}`;
    if (fs.existsSync(unc)) {
      report.unc = { overview: cli('audit-overview', unc), impact: cli('impact', unc,
        ['--file', 'src/helper.js']), diff: cli('audit-diff', unc),
        expectedFiles: 2, expectedImpact: 1, expectedChanged: ['src/helper.js'] };
    } else report.unc = { setupError: 'Local administrative share unavailable' };
    const scriptPath = path.join(root, 'setup-global-cli.ps1').replaceAll("'", "''");
    const policy = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive',
      '-ExecutionPolicy', 'Restricted', '-Command',
      `if ((Get-ExecutionPolicy) -ne 'Restricted') { exit 9 }; & '${scriptPath}'`],
      { encoding: 'utf8', windowsHide: true, timeout: 15000 });
    report.executionPolicy = { exitCode: policy.status,
      blockedBeforeScriptExecution: /PSSecurityException|UnauthorizedAccess/.test(policy.stderr),
      stderr: policy.stderr };
  }

  const encodingRepo = path.join(scratch, 'gbk');
  fs.mkdirSync(encodingRepo);
  fs.writeFileSync(path.join(encodingRepo, '模块.py'), 'def value():\n    return 42\n');
  fs.writeFileSync(path.join(encodingRepo, 'ascii.py'), 'from 模块 import value\n');
  fs.writeFileSync(path.join(encodingRepo, 'main.py'), Buffer.concat([
    Buffer.from('# coding: gbk\nfrom '), Buffer.from([0xc4, 0xa3, 0xbf, 0xe9]),
    Buffer.from(' import value\nprint(value())\n'),
  ]));
  const python = spawnSync('python', ['main.py'], { cwd: encodingRepo, encoding: 'utf8' });
  const gbk = cli('impact', encodingRepo, ['--file', '模块.py']);
  const gbkOverview = cli('audit-overview', encodingRepo);
  report.gbk = { pythonExit: python.status, pythonStdout: python.stdout.trim(),
    expectedCount: 2, actualCount: gbk.data.impactCount, exitCode: gbk.exitCode,
    warnings: gbk.data.warnings, dataQuality: gbk.data.dataQuality, coverage: coverage(gbkOverview.data),
    correct: gbk.data.impactCount === 2 };

  const gitRepo = makeRepo('git');
  git(gitRepo, ['init', '-b', 'main']);
  git(gitRepo, ['add', '.']);
  git(gitRepo, ['commit', '-m', '验证夹具基线']);
  git(gitRepo, ['checkout', '--detach']);
  fs.writeFileSync(path.join(gitRepo, 'src', 'helper.js'), 'module.exports = 2;\n');
  const detached = cli('audit-diff', gitRepo);
  report.detachedHead = { truth: git(gitRepo, ['diff', '--name-only']), ...detached };
  git(gitRepo, ['checkout', '--', 'src/helper.js']);
  const worktree = path.join(scratch, 'worktree');
  git(gitRepo, ['worktree', 'add', '--detach', worktree, 'HEAD']);
  fs.writeFileSync(path.join(worktree, 'src', 'helper.js'), 'module.exports = 3;\n');
  report.worktree = { truth: git(worktree, ['diff', '--name-only']),
    overview: cli('audit-overview', worktree), diff: cli('audit-diff', worktree) };

  const child = path.join(scratch, 'child');
  fs.mkdirSync(child);
  fs.writeFileSync(path.join(child, 'child.js'), 'module.exports = 4;\n');
  git(child, ['init', '-b', 'main']);
  git(child, ['add', '.']);
  git(child, ['commit', '-m', '子模块验证夹具']);
  git(gitRepo, ['-c', 'protocol.file.allow=always', 'submodule', 'add', child, 'sub/child']);
  git(gitRepo, ['commit', '-am', '加入验证子模块']);
  report.submodule = { expectedSourceFiles: 3, overview: cli('audit-overview', gitRepo) };
  fs.writeFileSync(path.join(gitRepo, 'sub', 'child', 'child.js'), 'module.exports = 5;\n');
  report.submodule.truth = git(gitRepo, ['diff', '--name-only']);
  report.submodule.diff = cli('audit-diff', gitRepo);

  const lifecycleCache = path.join(scratch, 'lifecycle-cache');
  const lifecycleEnv = { ...process.env, LOCALAPPDATA: lifecycleCache, XDG_CACHE_HOME: lifecycleCache };
  delete lifecycleEnv.WB_CACHE_DIR;
  for (let i = 0; i < 3; i++) {
    const dir = makeRepo(`cache-project-${i}`);
    for (let repeat = 0; repeat < 3; repeat++) {
      const result = spawnSync(process.execPath, [path.join(root, 'cli.js'), 'audit-overview',
        '--cwd', dir, '--json', '--quiet'], { encoding: 'utf8', timeout: 120000,
        env: lifecycleEnv });
      if (result.status !== 0) throw new Error(`Cache probe failed: ${result.stderr}`);
    }
    report[`cacheAfterProject${i + 1}`] = databases(lifecycleCache);
    removeInsideScratch(dir);
  }
  report.cacheAfterWorkspaceDeletion = databases(lifecycleCache);

  const out = path.join(__dirname, 'truth', 'platform-boundaries.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ out, junction: report.junction.correct,
    backslash: report.backslash.correct, gbk: { correct: report.gbk.correct,
      actualCount: report.gbk.actualCount, warnings: report.gbk.warnings },
    detachedExit: report.detachedHead.exitCode, worktreeExit: report.worktree.diff.exitCode,
    submoduleExit: report.submodule.overview.exitCode,
    cacheCounts: [1, 2, 3].map((i) => report[`cacheAfterProject${i}`].length),
    cachesAfterDeletion: report.cacheAfterWorkspaceDeletion.length }));
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
