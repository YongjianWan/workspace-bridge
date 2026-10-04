// @semantic — Filesystem and Git boundary fixtures with independent expected sets.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-u25-'));
const report = { platform: process.platform, cases: [] };
function cli(command, dir, args = []) {
  const run = spawnSync(process.execPath, [path.join(root, 'cli.js'), command, '--cwd', dir, ...args, '--json', '--quiet'], { encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, WB_CACHE_DIR: path.join(scratch, 'cache', path.basename(dir)) } });
  if (run.error) throw run.error;
  return { exitCode: run.status, data: run.stdout ? JSON.parse(run.stdout.replace(/^\uFEFF/, '')) : null, stderr: run.stderr };
}
function git(dir, args, input) {
  const run = spawnSync('git', args, { cwd: dir, encoding: 'utf8', input, maxBuffer: 32 * 1024 * 1024 });
  if (run.status !== 0) throw new Error(run.stderr);
  return run.stdout.trim();
}
function fixture(name, sources) {
  const dir = path.join(scratch, name);
  fs.mkdirSync(dir);
  for (const [file, content] of Object.entries(sources)) fs.writeFileSync(path.join(dir, file), content);
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.name', 'TruthFixture']);
  git(dir, ['config', 'user.email', 'truth@example.invalid']);
  git(dir, ['add', '.']);
  git(dir, ['commit', '-qm', 'initial']);
  return dir;
}
function capture(id, fn) {
  try { report.cases.push({ id, ...fn() }); } catch (error) { report.cases.push({ id, setupOrExecutionError: error.message }); }
  console.log(JSON.stringify({ id, completed: true }));
}
capture('ordinary-directory-symlink-cycle', () => {
  const dir = fixture('symlink', { 'main.js': "module.exports = require('./helper');\n", 'helper.js': 'module.exports = 1;\n' });
  fs.symlinkSync(dir, path.join(dir, 'loop'), 'dir');
  fs.writeFileSync(path.join(dir, 'helper.js'), 'module.exports = 2;\n');
  const overview = cli('audit-overview', dir);
  const diff = cli('audit-diff', dir);
  return { expectedSourceFiles: 2, expectedChanges: ['helper.js'], gitChanges: git(dir, ['diff', '--name-only']).split('\n'), overview, diff };
});
capture('case-sensitive-distinct-files', () => {
  const dir = fixture('case', { 'Foo.js': 'module.exports = 1;\n', 'foo.js': 'module.exports = 2;\n', 'main.js': "module.exports = require('./Foo') + require('./foo');\n" });
  if (fs.readdirSync(dir).filter((file) => file.toLowerCase() === 'foo.js').length !== 2) return { unavailable: 'Filesystem does not preserve distinct Foo.js/foo.js' };
  fs.writeFileSync(path.join(dir, 'Foo.js'), 'module.exports = 3;\n');
  return { expectedSourceFiles: 3, expectedChanges: ['Foo.js'], overview: cli('audit-overview', dir), diff: cli('audit-diff', dir), upperImpact: cli('impact', dir, ['--file', 'Foo.js']), lowerImpact: cli('impact', dir, ['--file', 'foo.js']) };
});
capture('long-history', () => {
  const dir = path.join(scratch, 'history');
  fs.mkdirSync(dir);
  git(dir, ['init', '-b', 'main']);
  const chunks = [];
  for (let i = 0; i < 1200; i++) {
    const content = `module.exports = ${i};\n`;
    const message = `commit ${i}`;
    chunks.push(`commit refs/heads/main\ncommitter TruthFixture <truth@example.invalid> ${1700000000 + i * 60} +0000\ndata ${Buffer.byteLength(message)}\n${message}\nM 100644 inline helper.js\ndata ${Buffer.byteLength(content)}\n${content}\n`);
  }
  git(dir, ['fast-import', '--quiet'], chunks.join(''));
  git(dir, ['reset', '--hard', 'main']);
  fs.writeFileSync(path.join(dir, 'helper.js'), 'module.exports = 1200;\n');
  return { expectedCommits: 1200, actualCommits: Number(git(dir, ['rev-list', '--count', 'HEAD'])), expectedChanges: ['helper.js'], overview: cli('audit-overview', dir, ['--with-history']), diff: cli('audit-diff', dir) };
});
report.scratch = scratch;
capture('submodule-parent-and-child-scope', () => {
  const child = fixture('child-source', { 'main.js': "module.exports = require('./helper');\n", 'helper.js': 'module.exports = 1;\n' });
  const parent = fixture('parent-source', { 'main.js': 'module.exports = 1;\n' });
  git(parent, ['-c', 'protocol.file.allow=always', 'submodule', 'add', child, 'sub/child']);
  git(parent, ['commit', '-am', 'add child']);
  const linkedChild = path.join(parent, 'sub/child');
  fs.writeFileSync(path.join(linkedChild, 'helper.js'), 'module.exports = 2;\n');
  return { expectedParentGitChanges: ['sub/child'], expectedChildGitChanges: ['helper.js'], parentGitChanges: git(parent, ['diff', '--name-only']).split('\n'), childGitChanges: git(linkedChild, ['diff', '--name-only']).split('\n'), parentOverview: cli('audit-overview', parent), parentDiff: cli('audit-diff', parent), childOverview: cli('audit-overview', linkedChild), childDiff: cli('audit-diff', linkedChild) };
});
fs.mkdirSync(path.join(__dirname, 'truth'), { recursive: true });
fs.writeFileSync(path.join(__dirname, `truth/u25-${process.platform}.json`), JSON.stringify(report, null, 2) + '\n');
