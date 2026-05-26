#!/usr/bin/env node
// @contract

const assert = require('assert');
const { runCli } = require('./test-helpers');

function testSecurityFindingsUseRuleIdNotRule() {
  const data = runCli(['audit-security', '--builtin-only', '--json', '--quiet']);
  assert(data.ok, 'audit-security should succeed');
  assert(Array.isArray(data.findings), 'should have findings array');
  for (const f of data.findings) {
    assert(f.ruleId !== undefined, 'every finding must have ruleId');
    assert(f.rule === undefined, 'findings must NOT have ambiguous "rule" field');
  }
}

function main() {
  testSecurityFindingsUseRuleIdNotRule();
  console.log('security-ruleId-test.js: all passed');
}

main();
