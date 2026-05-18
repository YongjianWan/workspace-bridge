const assert = require('assert');
const { runCli } = require('./test-helpers');

function run(args) {
  return runCli([...args, '--json', '--quiet']);
}

function testAuditFileHasValidationAdvice() {
  const result = run(['audit-file', '--file', 'src/utils/path.js']);
  assert.ok(result.validationAdvice, 'validationAdvice should exist');
  assert.ok(typeof result.validationAdvice.stackProfile === 'string', 'stackProfile should be a string');
  assert.ok(Array.isArray(result.validationAdvice.commands), 'commands should be an array');
  assert.ok(result.validationAdvice.commandCount >= 0, 'commandCount should be >= 0');
  assert.ok(typeof result.validationAdvice.suggestedCommand === 'string' && result.validationAdvice.suggestedCommand.length > 0, 'suggestedCommand should be a non-empty string');
  // P8-2: structured executable metadata
  for (const cmd of result.validationAdvice.commands) {
    assert.ok(cmd.executable != null, `command ${cmd.name} should have executable object`);
    assert.ok(typeof cmd.executable.command === 'string', `command ${cmd.name} should have executable.command`);
    assert.ok(Array.isArray(cmd.executable.args), `command ${cmd.name} should have executable.args array`);
    assert.ok(typeof cmd.executable.expectedExitCode === 'number', `command ${cmd.name} should have expectedExitCode`);
    assert.ok(typeof cmd.executable.onFailure === 'string', `command ${cmd.name} should have onFailure`);
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
