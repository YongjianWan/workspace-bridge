// @semantic
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { runCliInProcess, makeTempDir, cleanupTempDir } = require('./test-helpers');
const { buildFileValidationAdvice } = require('../src/cli/formatters/validation-advice');

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

async function testAuditFileGeneratesFocusedTestCommands() {
  const tmpDir = makeTempDir('wb-audit-file-vitest-');
  try {
    // Minimal vitest project fixture
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'test'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'vitest-fixture', scripts: { test: 'vitest run' } })
    );
    fs.writeFileSync(path.join(tmpDir, 'vitest.config.js'), 'export default { test: { globals: true } };\n');
    fs.writeFileSync(path.join(tmpDir, 'src', 'helpers.js'), 'export function helper() { return 1; }\n');
    fs.writeFileSync(
      path.join(tmpDir, 'test', 'helpers.test.js'),
      "import { helper } from '../src/helpers.js';\nimport { test, expect } from 'vitest';\ntest('helper', () => expect(helper()).toBe(1));\n"
    );

    const sourceFile = path.join(tmpDir, 'src', 'helpers.js');
    const testFile = path.join(tmpDir, 'test', 'helpers.test.js');
    const affectedTests = {
      affectedTestsCount: 1,
      affectedTests: [{ file: testFile, distance: 1, source: 'graph', via: [] }],
    };

    const advice = buildFileValidationAdvice(sourceFile, tmpDir, affectedTests);

    assert.ok(advice.commands.focused.length > 0, 'focused commands should be generated when affected tests exist');
    const directTestCmd = advice.commands.focused.find((c) => c.name === 'node-direct-tests');
    assert.ok(directTestCmd, 'node-direct-tests command should exist');
    assert.ok(directTestCmd.executable, 'command should have executable metadata');
    assert.strictEqual(directTestCmd.executable.command, 'npx', 'vitest command should use npx');
    assert.ok(directTestCmd.executable.args.includes('vitest'), 'args should include vitest');
    assert.ok(directTestCmd.executable.args.includes('run'), 'args should include run');
    const relativeTestFile = path.relative(tmpDir, testFile);
    assert.ok(
      directTestCmd.executable.args.some((arg) => arg.replace(/\\/g, '/') === relativeTestFile.replace(/\\/g, '/')),
      `args should include the affected test file ${relativeTestFile}`
    );
    assert.strictEqual(advice.suggestedCommand, directTestCmd.cmd, 'suggestedCommand should prefer focused direct tests');
  } finally {
    cleanupTempDir(tmpDir);
  }
}

async function executeTests() {
  await testAuditFileHasValidationAdvice();
  await testAuditFileHasFrameworkPattern();
  await testAuditFileFrameworkDetection();
  await testAuditFileGeneratesFocusedTestCommands();
}

executeTests();
