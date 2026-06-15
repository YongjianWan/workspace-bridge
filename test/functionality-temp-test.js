#!/usr/bin/env node
// @semantic
// @slow
/**
 * CLI 混合与 Python 框架/技术栈检测测试
 * Runs in isolated temporary workspaces concurrently.
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { runCliInProcess, runInDir, makeTempDir, cleanupTempDir } = require('./test-helpers');

async function testMixedStackDetection() {
  const tempRoot = makeTempDir('wb-cli-mixed-');
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

  const mixedDiff = await runCliInProcess(['audit-diff', '--cwd', tempRoot, '--json', '--quiet']);
  assert.strictEqual(mixedDiff.validationAdvice.stack.profile, 'mixed');
  assert.strictEqual(mixedDiff.validationAdvice.stack.node.testRunner, 'vitest');
  assert.strictEqual(mixedDiff.validationAdvice.stack.python.testRunner, 'pytest');
  assert.strictEqual(mixedDiff.validationAdvice.stack.python.framework, 'fastapi');

  const commandNames = [
    ...mixedDiff.validationAdvice.commands.smoke.map((c) => c.name),
    ...mixedDiff.validationAdvice.commands.focused.map((c) => c.name),
    ...mixedDiff.validationAdvice.commands.full.map((c) => c.name),
  ];
  assert(commandNames.includes('node-all-tests'));
  assert(commandNames.includes('python-all-tests'));

  cleanupTempDir(tempRoot);
}

async function testPythonFrameworks() {
  const flaskRoot = makeTempDir('wb-cli-flask-');
  const writeFlask = (rel, content) => {
    const full = path.join(flaskRoot, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  };
  writeFlask('pyproject.toml', '[project]\nname = "flask-app"\ndependencies = ["flask>=3.0", "pytest"]\n');
  writeFlask('pytest.ini', '[pytest]\n');
  writeFlask('app/main.py', 'def app():\n    return 1\n');
  runInDir('git', ['init'], flaskRoot);
  runInDir('git', ['config', 'user.email', 'test@example.com'], flaskRoot);
  runInDir('git', ['config', 'user.name', 'Test User'], flaskRoot);
  runInDir('git', ['add', '.'], flaskRoot);
  runInDir('git', ['commit', '-m', 'init'], flaskRoot);
  writeFlask('app/main.py', 'def app():\n    return 2\n');

  const flaskDiff = await runCliInProcess(['audit-diff', '--cwd', flaskRoot, '--json', '--quiet']);
  assert.strictEqual(flaskDiff.validationAdvice.stack.profile, 'python-first');
  assert.strictEqual(flaskDiff.validationAdvice.stack.python.framework, 'flask');

  cleanupTempDir(flaskRoot);

  const djangoRoot = makeTempDir('wb-cli-django-');
  const writeDjango = (rel, content) => {
    const full = path.join(djangoRoot, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  };
  writeDjango('manage.py', '#!/usr/bin/env python\n');
  writeDjango('requirements.txt', 'flask\npytest\n');
  writeDjango('pytest.ini', '[pytest]\n');
  writeDjango('app/views.py', 'def index():\n    return 1\n');
  runInDir('git', ['init'], djangoRoot);
  runInDir('git', ['config', 'user.email', 'test@example.com'], djangoRoot);
  runInDir('git', ['config', 'user.name', 'Test User'], djangoRoot);
  runInDir('git', ['add', '.'], djangoRoot);
  runInDir('git', ['commit', '-m', 'init'], djangoRoot);
  writeDjango('app/views.py', 'def index():\n    return 2\n');

  const djangoDiff = await runCliInProcess(['audit-diff', '--cwd', djangoRoot, '--json', '--quiet']);
  assert.strictEqual(djangoDiff.validationAdvice.stack.python.framework, 'django');

  cleanupTempDir(djangoRoot);
}

async function main() {
  await testMixedStackDetection();
  await testPythonFrameworks();
}

main();
