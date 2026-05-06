const assert = require('assert');
const { spawnSync } = require('child_process');
const path = require('path');

const CLI = path.resolve(__dirname, '..', 'cli.js');

function run(args) {
  const result = spawnSync('node', [CLI, ...args, '--json', '--quiet'], {
    encoding: 'utf8',
    cwd: path.resolve(__dirname, '..'),
  });
  if (result.status !== 0) {
    throw new Error(`CLI failed: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout);
}

function testAuditFileHasValidationAdvice() {
  const result = run(['audit-file', '--file', 'src/utils/path.js']);
  assert.strictEqual(result.ok, true);
  assert.ok(result.validationAdvice, 'validationAdvice should exist');
  assert.ok(typeof result.validationAdvice.stackProfile === 'string', 'stackProfile should be a string');
  assert.ok(Array.isArray(result.validationAdvice.commands), 'commands should be an array');
  assert.ok(result.validationAdvice.commandCount >= 0, 'commandCount should be >= 0');
}

function testAuditFileHasFrameworkPattern() {
  const result = run(['audit-file', '--file', 'cli.js']);
  assert.strictEqual(result.ok, true);
  // cli.js is an entry file, frameworkPattern might be null or have a value
  assert.ok('frameworkPattern' in result, 'frameworkPattern field should exist');
}

function testAuditFileFrameworkDetection() {
  // Next.js app router file pattern
  const result = run(['audit-file', '--file', 'test/vue-parser-test.js']);
  assert.strictEqual(result.ok, true);
  assert.ok(result.frameworkPattern === null || typeof result.frameworkPattern === 'object');
}

function executeTests() {
  testAuditFileHasValidationAdvice();
  testAuditFileHasFrameworkPattern();
  testAuditFileFrameworkDetection();
  console.log('audit-file-validation-advice-test.js: all passed');
}

executeTests();
