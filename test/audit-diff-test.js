#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..');
const cliPath = path.join(repoRoot, 'cli.js');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-bridge-audit-diff-'));

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
  });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

function commitAll(message, authorName, authorEmail) {
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: authorName,
    GIT_AUTHOR_EMAIL: authorEmail,
    GIT_COMMITTER_NAME: authorName,
    GIT_COMMITTER_EMAIL: authorEmail,
  };
  const result = spawnSync('git', ['commit', '-m', message], {
    cwd: tempRoot,
    encoding: 'utf8',
    env,
  });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
}

function writeFile(relativePath, content) {
  const fullPath = path.join(tempRoot, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

try {
  writeFile('package.json', JSON.stringify({
    name: 'audit-diff-fixture',
    version: '1.0.0',
    main: 'src/app.js',
  }, null, 2));
  writeFile('src/util.js', [
    'ex' + 'port function helper() {',
    "  return 'ok';",
    '}',
    '',
  ].join('\n'));
  writeFile('src/app.js', [
    "im" + "port { helper } from './util';",
    '',
    'ex' + 'port function run() {',
    '  return helper();',
    '}',
    '',
  ].join('\n'));
  writeFile('test/app.test.js', [
    "im" + "port { run } from '../src/app';",
    '',
    'ex' + 'port function testRun() {',
    '  return run();',
    '}',
    '',
  ].join('\n'));

  run('git', ['init'], tempRoot);
  run('git', ['config', 'user.email', 'test@example.com'], tempRoot);
  run('git', ['config', 'user.name', 'Test User'], tempRoot);
  run('git', ['add', '.'], tempRoot);
  commitAll('init', 'Test User', 'test@example.com');

  writeFile('src/util.js', [
    'ex' + 'port function helper() {',
    "  return 'v2';",
    '}',
    '',
  ].join('\n'));
  run('git', ['add', 'src/util.js'], tempRoot);
  commitAll('feature: refine util', 'Alice', 'alice@example.com');

  writeFile('src/util.js', [
    'ex' + 'port function helper() {',
    "  return 'rollback-safe';",
    '}',
    '',
  ].join('\n'));
  run('git', ['add', 'src/util.js'], tempRoot);
  commitAll('revert: util regression', 'Bob', 'bob@example.com');

  writeFile('src/util.js', [
    'ex' + 'port function helper() {',
    "  return 'changed';",
    '}',
    '',
  ].join('\n'));

  const result = run('node', [cliPath, 'audit-diff', '--cwd', tempRoot, '--json', '--quiet'], repoRoot);
  const parsed = JSON.parse(result);

  assert.strictEqual(parsed.ok, true);
  assert.strictEqual(parsed.summary.counts.changedFiles, 1);
  assert.strictEqual(parsed.summary.counts.mainlineChangedFiles, 1);
  assert.strictEqual(parsed.changedFiles.length, 1);

  const changed = parsed.changedFiles[0];
  assert.strictEqual(changed.file.replace(/\\/g, '/'), 'src/util.js');
  assert.strictEqual(changed.classification.directoryRole, 'active');
  assert.strictEqual(changed.impactCount >= 1, true);
  assert.strictEqual(changed.affectedTestCount >= 1, true);
  assert.strictEqual(changed.historyRisk.level, 'high');
  assert.strictEqual(changed.historyRisk.authorCount >= 3, true);
  assert.strictEqual(changed.historyRisk.revertLikeCount >= 1, true);
  assert.strictEqual(parsed.summary.counts.highHistoryRiskFiles, 1);
  assert(changed.affectedTests.some((entry) => entry.file.replace(/\\/g, '/').endsWith('/test/app.test.js')));

  console.log('audit-diff-test: ok');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
