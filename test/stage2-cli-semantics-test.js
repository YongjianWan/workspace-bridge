// @semantic
// @slow
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

const root = makeTempDir('wb-stage2-cli-');
const cacheDir = makeTempDir('wb-stage2-cli-cache-');
function write(file, content) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}
function run(args) {
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '../cli.js'), ...args, '--cwd', root, '--quiet'], {
    encoding: 'utf8', timeout: 90000, env: { ...process.env, WB_CACHE_DIR: cacheDir },
  });
  assert.ifError(result.error);
  assert.strictEqual(result.status, 0, result.stderr);
  return result.stdout;
}
function verifyReview(advice) {
  assert.strictEqual(advice.changeType, 'docs');
  assert(Object.values(advice.commands).flat().every((command) => ['git-diff-check', 'git-diff-stat', 'mixed-review'].includes(command.name)), 'generated/docs changes must not request code validation');
}
try {
  write('package.json', JSON.stringify({ name: 'fixture', scripts: { test: 'jest' }, devDependencies: { jest: '*', eslint: '*' } }));
  write('.workspace-bridge.json', JSON.stringify({ directories: { generated: ['artifacts'] } }));
  write('src/a.js', 'const b = require("./b"); exports.a = b;');
  write('src/b.js', 'const a = require("./a"); exports.b = a;');
  write('artifacts/out.js', 'exports.generated = 1;');
  write('README.md', '# fixture');
  for (const args of [['init'], ['add', '.'], ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture']]) {
    execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  }
  for (const file of ['artifacts/out.js', 'README.md', 'src/a.js']) fs.appendFileSync(path.join(root, file), '\n');
  const guard = run(['guard', '--files', 'src/a.js,src/b.js', '--format', 'human']);
  assert(guard.includes('Guard Status: PASSED'));
  assert(guard.includes('[already shown]'), 'CLI must expose repeated edges without recursion');
  assert(guard.length < 3000, 'two-node cycle must produce finite output');

  const generated = JSON.parse(run(['audit-diff', '--files', 'artifacts/out.js', '--json']));
  assert.strictEqual(generated.changedFiles.length, 1, 'generated changes remain visible in the audit');
  assert.strictEqual(generated.changedFiles[0].classification.directoryRole, 'generated');
  assert.strictEqual(generated.changedFiles[0].classification.isMainline, false);
  verifyReview(generated.validationAdvice);
  const docs = JSON.parse(run(['audit-diff', '--files', 'artifacts/out.js,README.md', '--json']));
  assert.strictEqual(docs.changedFiles.length, 2);
  verifyReview(docs.validationAdvice);
  const source = JSON.parse(run(['audit-diff', '--files', 'artifacts/out.js,src/a.js', '--json']));
  assert.strictEqual(source.validationAdvice.changeType, 'code');
  const targets = Object.values(source.validationAdvice.commands).flat()
    .flatMap((command) => command.executable?.args || []).map((arg) => arg.replace(/\\/g, '/'));
  assert(targets.some((arg) => arg.endsWith('src/a.js')), 'real source remains a validation target on either platform');
  assert(!targets.some((arg) => arg.endsWith('artifacts/out.js')), 'generated artifact must not be passed to a code validator');
  console.log('stage2-cli-semantics-test: all passed');
} finally {
  cleanupTempDir(root);
  cleanupTempDir(cacheDir);
}
