#!/usr/bin/env node
/**
 * CLI 功能可用性测试
 */
const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..');
const cliPath = path.join(repoRoot, 'cli.js');

function runCli(args) {
  const result = spawnSync('node', [cliPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function runInDir(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
  });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

function main() {
  console.log('=== workspace-bridge CLI 功能可用性测试 ===\n');

  const workspaceInfo = runCli(['workspace-info', '--cwd', '.', '--json', '--quiet']);
  assert.strictEqual(workspaceInfo.workspaceRoot, repoRoot);
  console.log('workspace-info: ok');

  const health = runCli(['health', '--cwd', '.', '--json', '--quiet']);
  assert.strictEqual(health.ok, true);
  console.log('health: ok');

  const summary = runCli(['audit-summary', '--cwd', '.', '--json', '--quiet']);
  assert.strictEqual(summary.ok, true);
  assert(summary.scope.counts.totalFiles >= 1);
  console.log('audit-summary: ok');

  const fileAudit = runCli(['audit-file', '--cwd', '.', '--file', 'src/services/container.js', '--json', '--quiet']);
  assert.strictEqual(fileAudit.ok, true);
  assert(fileAudit.impact.impactCount >= 0);
  console.log('audit-file: ok');

  const diffAudit = runCli(['audit-diff', '--cwd', '.', '--json', '--quiet']);
  assert.strictEqual(diffAudit.ok, true);
  assert(diffAudit.summary.counts.changedFiles >= 1);
  assert(diffAudit.validationAdvice.stack.profile);
  console.log('audit-diff: ok');

  // Mixed repo stack detection
  {
    const fs = require('fs');
    const os = require('os');
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-cli-mixed-'));
    const write = (rel, content) => {
      const full = path.join(tempRoot, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf8');
    };
    write('package.json', JSON.stringify({ name: 'mixed-test', version: '1.0.0', scripts: { test: 'vitest' } }, null, 2));
    write('package-lock.json', '{}');
    write('vitest.config.js', 'export default {};');
    write('requirements.txt', 'fastapi\npytest\n');
    write('pytest.ini', '[pytest]\n');
    write('src/app.js', 'export const run = () => 1;\n');
    write('api/main.py', 'def app():\n    return 1\n');
    write('src/app.test.js', 'import { run } from "./app";\n');
    runInDir('git', ['init'], tempRoot);
    runInDir('git', ['config', 'user.email', 'test@example.com'], tempRoot);
    runInDir('git', ['config', 'user.name', 'Test User'], tempRoot);
    runInDir('git', ['add', '.'], tempRoot);
    runInDir('git', ['commit', '-m', 'init'], tempRoot);
    write('src/app.js', 'export const run = () => 2;\n');
    write('api/main.py', 'def app():\n    return 2\n');
    const mixedDiff = runCli(['audit-diff', '--cwd', tempRoot, '--json', '--quiet']);
    assert.strictEqual(mixedDiff.validationAdvice.stack.profile, 'mixed');
    assert.strictEqual(mixedDiff.validationAdvice.stack.node.testRunner, 'vitest');
    assert.strictEqual(mixedDiff.validationAdvice.stack.python.testRunner, 'pytest');
    const commandNames = [
      ...mixedDiff.validationAdvice.commands.smoke.map((c) => c.name),
      ...mixedDiff.validationAdvice.commands.focused.map((c) => c.name),
      ...mixedDiff.validationAdvice.commands.full.map((c) => c.name),
    ];
    assert(commandNames.includes('node-all-tests'));
    assert(commandNames.includes('python-all-tests'));
    fs.rmSync(tempRoot, { recursive: true, force: true });
    console.log('mixed-stack-detection: ok');
  }

  // Polyglot symbol-level impact (JS/Python/Java)
  {
    const fs = require('fs');
    const os = require('os');
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-cli-polyglot-'));
    const write = (rel, content) => {
      const full = path.join(tempRoot, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf8');
    };
    write('package.json', JSON.stringify({ name: 'polyglot-test', version: '1.0.0' }, null, 2));
    write('requirements.txt', 'fastapi\npytest\n');
    write('pytest.ini', '[pytest]\n');
    write('pom.xml', '<project><modelVersion>4.0.0</modelVersion><groupId>com.example</groupId><artifactId>polyglot</artifactId><version>1.0.0</version></project>');
    write('src/util.js', 'export function utilFn() { return 1; }\n');
    write('src/index.js', 'import { utilFn } from "./util";\nexport function run() { return utilFn(); }\n');
    write('api/util.py', 'def helper():\n    return 1\n');
    write('api/app.py', 'from .util import helper\n\ndef run():\n    return helper()\n');
    write('src/main/java/com/example/Util.java', 'package com.example;\npublic class Util { public static int value() { return 1; } }\n');
    write('src/main/java/com/example/App.java', 'package com.example;\nimport com.example.Util;\npublic class App { public int run() { return Util.value(); } }\n');
    write('src/test/java/com/example/AppTest.java', 'package com.example;\nimport com.example.App;\npublic class AppTest { public int run() { return new App().run(); } }\n');
    runInDir('git', ['init'], tempRoot);
    runInDir('git', ['config', 'user.email', 'test@example.com'], tempRoot);
    runInDir('git', ['config', 'user.name', 'Test User'], tempRoot);
    runInDir('git', ['add', '.'], tempRoot);
    runInDir('git', ['commit', '-m', 'init'], tempRoot);
    write('src/util.js', 'export function utilFn() { return 2; }\n');
    write('api/util.py', 'def helper():\n    return 2\n');
    write('src/main/java/com/example/Util.java', 'package com.example;\npublic class Util { public static int value() { return 2; } }\n');
    const polyDiff = runCli(['audit-diff', '--cwd', tempRoot, '--json', '--quiet']);
    assert.strictEqual(polyDiff.ok, true);
    assert(Array.isArray(polyDiff.changedFiles));
    const byFile = new Map(polyDiff.changedFiles.map((entry) => [entry.file.replace(/\\/g, '/'), entry]));
    const jsEntry = byFile.get('src/util.js');
    const pyEntry = byFile.get('api/util.py');
    const javaEntry = byFile.get('src/main/java/com/example/Util.java');
    assert(jsEntry?.symbolImpact, 'js symbolImpact should exist');
    assert(pyEntry?.symbolImpact, 'python symbolImpact should exist');
    assert(javaEntry?.symbolImpact, 'java symbolImpact should exist');
    assert(jsEntry.impactCount >= 1);
    assert(pyEntry.impactCount >= 1);
    assert(javaEntry.impactCount >= 1);
    assert(javaEntry.affectedTestCount >= 1);
    fs.rmSync(tempRoot, { recursive: true, force: true });
    console.log('polyglot-symbol-impact: ok');
  }

  const overview = runCli(['audit-overview', '--cwd', '.', '--json', '--quiet']);
  assert.strictEqual(overview.ok, true);
  assert(overview.skeleton.totalFiles >= 1);
  console.log('audit-overview: ok');

  // Non-ASCII path regression check
  {
    const fs = require('fs');
    const os = require('os');
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-cli-cn-'));
    const write = (rel, content) => {
      const full = path.join(tempRoot, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf8');
    };
    write('package.json', JSON.stringify({ name: 'cn-test', version: '1.0.0', main: 'src/index.js' }, null, 2));
    write('src/模块.js', 'export function 你好() { return 42; }\n');
    write('src/index.js', 'import { 你好 } from "./模块";\nexport function main() { return 你好(); }\n');
    const cnUnresolved = runCli(['unresolved', '--cwd', tempRoot, '--json', '--quiet']);
    const cnImpact = runCli(['impact', '--cwd', tempRoot, '--file', 'src/模块.js', '--json', '--quiet']);
    assert.strictEqual(cnUnresolved.unresolvedCount, 0);
    assert.strictEqual(cnImpact.impactCount, 1);
    fs.rmSync(tempRoot, { recursive: true, force: true });
    console.log('non-ascii-paths: ok');
  }

  const deadExports = runCli(['dead-exports', '--cwd', '.', '--json', '--quiet']);
  assert.strictEqual(deadExports.ok, true);
  assert(Array.isArray(deadExports.deadExports));
  console.log('dead-exports: ok');

  const unresolved = runCli(['unresolved', '--cwd', '.', '--json', '--quiet']);
  assert.strictEqual(unresolved.ok, true);
  assert(Array.isArray(unresolved.unresolved));
  console.log('unresolved: ok');

  const cycles = runCli(['cycles', '--cwd', '.', '--json', '--quiet']);
  assert.strictEqual(cycles.ok, true);
  assert(Array.isArray(cycles.cycles));
  console.log('cycles: ok');

  console.log('\nAll CLI functionality tests passed');
}

main();
