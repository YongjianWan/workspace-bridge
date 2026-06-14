#!/usr/bin/env node
// @contract

const assert = require('assert');
const { runCliInProcess, shutdownSharedContainer } = require('./test-helpers');

async function testAuditFileValidationAdviceSchema() {
  const data = await runCliInProcess(['audit-file', '--file', 'src/services/container.js', '--json', '--quiet']);
  assert(data.ok, 'audit-file should succeed');
  const va = data.validationAdvice;
  assert(va, 'should have validationAdvice');
  assert(typeof va.changeType === 'string', 'should have changeType');
  assert(typeof va.commands === 'object' && !Array.isArray(va.commands), 'commands should be grouped object');
  assert(Array.isArray(va.commands.smoke), 'commands.smoke should be array');
  assert(Array.isArray(va.commands.focused), 'commands.focused should be array');
  assert(Array.isArray(va.commands.full), 'commands.full should be array');
  assert(Array.isArray(va.phases), 'phases should be array');
  assert(typeof va.suggestedCommand === 'string' || va.suggestedCommand === null, 'should have suggestedCommand');
  assert(Array.isArray(va.fileSpecificAdvice), 'fileSpecificAdvice should be array');
  assert(va.stackProfile === undefined, 'should not have stackProfile (removed for schema uniformity)');
  assert(va.commandCount === undefined, 'should not have commandCount (removed for schema uniformity)');
}

async function testAuditDiffValidationAdviceSchema() {
  const data = await runCliInProcess(['audit-diff', '--json', '--quiet']);
  assert(data.ok, 'audit-diff should succeed');
  const va = data.validationAdvice;
  assert(va, 'should have validationAdvice');
  assert(typeof va.changeType === 'string', 'should have changeType');
  assert(typeof va.commands === 'object' && !Array.isArray(va.commands), 'commands should be grouped object');
  assert(Array.isArray(va.commands.smoke), 'commands.smoke should be array');
  assert(Array.isArray(va.commands.focused), 'commands.focused should be array');
  assert(Array.isArray(va.commands.full), 'commands.full should be array');
  assert(Array.isArray(va.phases), 'phases should be array');
  assert(typeof va.suggestedCommand === 'string' || va.suggestedCommand === null, 'should have suggestedCommand');
}

async function main() {
  await testAuditFileValidationAdviceSchema();
  await testAuditDiffValidationAdviceSchema();
  shutdownSharedContainer();
  console.log('validation-advice-schema-test.js: all passed');
}

main();
