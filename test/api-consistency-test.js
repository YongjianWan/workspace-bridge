#!/usr/bin/env node
// @contract
/**
 * API Consistency Check
 * Verifies public API contracts touched by this round of fixes.
 */
const assert = require('assert');
const { COMMANDS } = require('../src/cli/commands');
const { formatHuman, formatSummary, formatMarkdown, formatJsonl } = require('../src/cli/formatters/human-formatters');

function checkQueryErrorEnvelope() {
  const err = { ok: false, error: 'Database modification or set-operation keywords are not allowed' };

  const human = formatHuman('query', err);
  assert(human.includes('Error:') && human.includes(err.error), 'human format should surface query error');

  const summary = formatSummary('query', err);
  assert(summary.includes('Error:') && summary.includes(err.error), 'summary format should surface query error');

  const md = formatMarkdown('query', err);
  assert(md.includes('Error') && md.includes(err.error), 'markdown format should surface query error');

  const jsonl = formatJsonl('query', err);
  const parsed = JSON.parse(jsonl);
  assert.strictEqual(parsed._type, 'error');
  assert.strictEqual(parsed.error, err.error);
}

function checkBuildSafeEnvExportAndBehavior() {
  const { buildSafeEnv } = require('../src/utils/command');
  assert.strictEqual(typeof buildSafeEnv, 'function', 'buildSafeEnv should be exported from command.js');

  process.env.WB_TEST_API_SECRET = 'should-not-leak';
  try {
    const env = buildSafeEnv();
    assert.strictEqual(env.PYTHONIOENCODING, 'utf-8', 'PYTHONIOENCODING should be utf-8');
    assert.strictEqual(env.WB_TEST_API_SECRET, undefined, 'sensitive env var should not leak');
    assert.strictEqual(env.PATH, process.env.PATH, 'PATH should be preserved');

    const withExtra = buildSafeEnv({ WB_EXTRA: 'allowed' });
    assert.strictEqual(withExtra.WB_EXTRA, 'allowed', 'explicit extraEnv should be included');
  } finally {
    delete process.env.WB_TEST_API_SECRET;
  }
}

function checkQueryCommandRegistered() {
  assert.strictEqual(typeof COMMANDS.query, 'function', 'query command should be registered');
}

function main() {
  checkQueryCommandRegistered();
  console.log('  PASS checkQueryCommandRegistered');
  checkQueryErrorEnvelope();
  console.log('  PASS checkQueryErrorEnvelope');
  checkBuildSafeEnvExportAndBehavior();
  console.log('  PASS checkBuildSafeEnvExportAndBehavior');
  console.log('API consistency check ... PASS');
}

main();
