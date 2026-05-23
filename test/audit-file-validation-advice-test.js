const assert = require('assert');
const { runCli } = require('./test-helpers');

function run(args) {
  return runCli([...args, '--json', '--quiet']);
}

function testAuditFileHasValidationAdvice() {
  const result = run(['audit-file', '--file', 'src/utils/path.js']);
  assert.ok(result.validationAdvice, 'validationAdvice should exist');
  assert.strictEqual(result.validationAdvice.stackProfile, 'node-first', 'stackProfile should be node-first');
  assert.ok(Array.isArray(result.validationAdvice.commands), 'commands should be an array');
  assert.ok(result.validationAdvice.commands.length > 0, 'commands list should not be empty');
  assert.strictEqual(result.validationAdvice.commandCount, result.validationAdvice.commands.length, 'commandCount should equal commands array length');
  assert.strictEqual(result.validationAdvice.suggestedCommand, 'npm run test', 'suggestedCommand should be "npm run test" for JS file');
  // P8-2: structured executable metadata
  for (const cmd of result.validationAdvice.commands) {
    assert.ok(cmd.executable != null, `command ${cmd.name} should have executable object`);
    assert.strictEqual(cmd.executable.command, 'npm', `command ${cmd.name} should use npm`);
    assert.deepStrictEqual(cmd.executable.args, ['run', 'test'], `command ${cmd.name} should have ['run', 'test'] arguments`);
    assert.strictEqual(cmd.executable.expectedExitCode, 0, `command ${cmd.name} expected exit code should be 0`);
    assert.strictEqual(cmd.executable.onFailure, 'abort', `command ${cmd.name} failure action should be abort`);
  }
}

function testAuditFileHasFrameworkPattern() {
  const result = run(['audit-file', '--file', 'cli.js']);
  assert.strictEqual(result.file, 'cli.js', 'file should match request');
  assert.strictEqual(result.summary.severity, 'low', 'cli.js severity should be low');
  assert.strictEqual(result.frameworkPattern, null, 'cli.js should have no framework pattern');
  assert.ok('frameworkPattern' in result, 'frameworkPattern field should exist');
}

function testAuditFileFrameworkDetection() {
  const result = run(['audit-file', '--file', 'test/vue-parser-test.js']);
  assert.strictEqual(result.file, 'test/vue-parser-test.js', 'file should match request');
  assert.ok(result.frameworkPattern && result.frameworkPattern.framework === 'vue', 'vue test file should detect vue framework');
  assert.strictEqual(result.frameworkPattern.isEntry, true, 'vue test file should be marked as entry');
}

function executeTests() {
  testAuditFileHasValidationAdvice();
  testAuditFileHasFrameworkPattern();
  testAuditFileFrameworkDetection();
}

executeTests();
