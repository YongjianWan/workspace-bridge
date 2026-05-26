#!/usr/bin/env node
// @contract

const assert = require('assert');
const { runCliRaw } = require('./test-helpers');

function testFormatAiIncludesValidationAdvice() {
  const result = runCliRaw(['audit-file', '--file', 'src/services/container.js', '--format', 'ai', '--json', '--quiet']);
  assert.strictEqual(result.status, 0, 'should exit 0');
  const data = JSON.parse(result.stdout);
  assert(data.validationAdvice, 'should include validationAdvice');
  assert(typeof data.validationAdvice.commands === 'object', 'validationAdvice.commands should be object');
  assert(Array.isArray(data.validationAdvice.commands.smoke), 'should have smoke commands');
  assert(Array.isArray(data.validationAdvice.commands.focused), 'should have focused commands');
  assert(Array.isArray(data.validationAdvice.commands.full), 'should have full commands');
}

function testFormatAiIncludesImpact() {
  const result = runCliRaw(['audit-file', '--file', 'src/services/container.js', '--format', 'ai', '--json', '--quiet']);
  assert.strictEqual(result.status, 0, 'should exit 0');
  const data = JSON.parse(result.stdout);
  assert(Array.isArray(data.impact), 'should include impact array');
  assert(data.impact.length > 0, 'impact should have items');
  assert(data.impact[0].file, 'impact items should have file');
}

function testFormatAiIncludesAffectedTests() {
  const result = runCliRaw(['audit-file', '--file', 'src/services/container.js', '--format', 'ai', '--json', '--quiet']);
  assert.strictEqual(result.status, 0, 'should exit 0');
  const data = JSON.parse(result.stdout);
  assert(Array.isArray(data.affectedTests), 'should include affectedTests array');
  assert(data.affectedTests.length > 0, 'affectedTests should have items');
}

function main() {
  testFormatAiIncludesValidationAdvice();
  testFormatAiIncludesImpact();
  testFormatAiIncludesAffectedTests();
  console.log('format-ai-fields-test.js: all passed');
}

main();
