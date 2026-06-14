const assert = require('assert');
const { runCliInProcess } = require('./test-helpers');

async function run(args) {
  return runCliInProcess([...args, '--json', '--quiet']);
}

async function testAuditFileHasValidationAdvice() {
  const result = await run(['audit-file', '--file', 'src/utils/path.js']);
  assert.ok(result.validationAdvice, 'validationAdvice should exist');
  assert.strictEqual(typeof result.validationAdvice.commands, 'object', 'commands should be grouped object');
  assert.ok(Array.isArray(result.validationAdvice.commands.smoke), 'commands.smoke should be array');
  assert.ok(Array.isArray(result.validationAdvice.commands.focused), 'commands.focused should be array');
  assert.ok(Array.isArray(result.validationAdvice.commands.full), 'commands.full should be array');
  assert.ok(result.validationAdvice.commands.smoke.length > 0 || result.validationAdvice.commands.focused.length > 0 || result.validationAdvice.commands.full.length > 0, 'commands should not all be empty');
  assert.strictEqual(result.validationAdvice.suggestedCommand, 'npm run test', 'suggestedCommand should be "npm run test" for JS file');
  // P8-2: structured executable metadata
  const allCommands = [
    ...result.validationAdvice.commands.smoke,
    ...result.validationAdvice.commands.focused,
    ...result.validationAdvice.commands.full,
  ];
  for (const cmd of allCommands) {
    assert.ok(cmd.executable != null, `command ${cmd.name} should have executable object`);
    assert.strictEqual(cmd.executable.command, 'npm', `command ${cmd.name} should use npm`);
    assert.deepStrictEqual(cmd.executable.args, ['run', 'test'], `command ${cmd.name} should have ['run', 'test'] arguments`);
    assert.strictEqual(cmd.executable.expectedExitCode, 0, `command ${cmd.name} expected exit code should be 0`);
    assert.strictEqual(cmd.executable.onFailure, 'abort', `command ${cmd.name} failure action should be abort`);
  }
}

async function testAuditFileHasFrameworkPattern() {
  const result = await run(['audit-file', '--file', 'cli.js']);
  assert.strictEqual(result.file, 'cli.js', 'file should match request');
  assert.ok(['low', 'medium', 'high'].includes(result.summary.severity), `cli.js severity should be a valid level, got ${result.summary.severity}`);
  assert.strictEqual(result.frameworkPattern, null, 'cli.js should have no framework pattern');
  assert.ok('frameworkPattern' in result, 'frameworkPattern field should exist');
}

async function testAuditFileFrameworkDetection() {
  const result = await run(['audit-file', '--file', 'test/vue-parser-test.js']);
  assert.strictEqual(result.file, 'test/vue-parser-test.js', 'file should match request');
  assert.ok(result.frameworkPattern && result.frameworkPattern.framework === 'vue', 'vue test file should detect vue framework');
  assert.strictEqual(result.frameworkPattern.isEntry, true, 'vue test file should be marked as entry');
}

async function executeTests() {
  await testAuditFileHasValidationAdvice();
  await testAuditFileHasFrameworkPattern();
  await testAuditFileFrameworkDetection();
}

executeTests();
