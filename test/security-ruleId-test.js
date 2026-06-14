#!/usr/bin/env node
// @contract

const assert = require('assert');
const { runCliInProcess } = require('./test-helpers');

async function testSecurityFindingsUseRuleIdNotRule() {
  const data = await runCliInProcess(['audit-security', '--builtin-only', '--json', '--quiet']);
  assert(data.ok, 'audit-security should succeed');
  assert(Array.isArray(data.findings), 'should have findings array');
  for (const f of data.findings) {
    assert(f.ruleId !== undefined, 'every finding must have ruleId');
    assert.strictEqual(f.rule, f.ruleId, 'f.rule should be an alias of f.ruleId');
  }
}

async function main() {
  await testSecurityFindingsUseRuleIdNotRule();
  console.log('security-ruleId-test.js: all passed');
}

main();
