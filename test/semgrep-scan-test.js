#!/usr/bin/env node
/**
 * SemgrepAdapter.scan() boundary tests.
 * Mocks runCommandSecure to avoid requiring semgrep to be installed.
 */
const assert = require('assert');
const path = require('path');
const commandModule = require('../src/utils/command');

const originalRunCommandSecure = commandModule.runCommandSecure;

function mockRunCommandSecure(response) {
  commandModule.runCommandSecure = async () => response;
}

function restoreRunCommandSecure() {
  commandModule.runCommandSecure = originalRunCommandSecure;
}

// Reload SemgrepAdapter so it picks up the mocked (or restored) runCommandSecure
function getAdapter() {
  delete require.cache[require.resolve('../src/adapters/semgrep')];
  delete require.cache[require.resolve('../src/adapters/base')];
  const { SemgrepAdapter } = require('../src/adapters/semgrep');
  return new SemgrepAdapter();
}

async function main() {
  console.log('=== SemgrepAdapter scan boundary test ===\n');

  // 1. Empty targets
  let adapter = getAdapter();
  const empty = await adapter.scan([], {});
  assert.deepStrictEqual(empty.findings, [], 'empty targets should return empty findings');
  assert.strictEqual(empty.summary.total, 0, 'empty targets summary.total should be 0');
  console.log('empty-targets: ok');

  // 2. Null/undefined targets
  adapter = getAdapter();
  const nullTargets = await adapter.scan(null, {});
  assert.deepStrictEqual(nullTargets.findings, [], 'null targets should return empty findings');
  console.log('null-targets: ok');

  // 3. Non-zero exit code
  mockRunCommandSecure({ ok: false, stdout: '', stderr: 'command not found', exitCode: 1 });
  adapter = getAdapter();
  const fail = await adapter.scan(['src'], {});
  assert.deepStrictEqual(fail.findings, [], 'non-zero exit should return empty findings');
  assert.ok(fail.summary.error, 'non-zero exit should include error message');
  console.log('non-zero-exit: ok');

  // 4. Invalid JSON output
  mockRunCommandSecure({ ok: true, stdout: 'not-json{', stderr: '', exitCode: 0 });
  adapter = getAdapter();
  const badJson = await adapter.scan(['src'], {});
  assert.deepStrictEqual(badJson.findings, [], 'invalid JSON should return empty findings');
  assert.ok(badJson.summary.error.includes('Invalid JSON'), 'invalid JSON should report parse error');
  console.log('invalid-json: ok');

  // 5. Valid empty JSON result
  mockRunCommandSecure({ ok: true, stdout: JSON.stringify({ results: [], errors: [] }), stderr: '', exitCode: 0 });
  adapter = getAdapter();
  const emptyJson = await adapter.scan(['src'], {});
  assert.deepStrictEqual(emptyJson.findings, [], 'empty results array should return empty findings');
  assert.strictEqual(emptyJson.summary.total, 0, 'empty results summary.total should be 0');
  console.log('valid-empty-json: ok');

  // 6. Command injection safety — config should be passed as argument, not shell string
  const capturedArgs = [];
  commandModule.runCommandSecure = async (cmd, args) => {
    capturedArgs.push(...args);
    return { ok: true, stdout: JSON.stringify({ results: [], errors: [] }), stderr: '', exitCode: 0 };
  };
  adapter = getAdapter();
  await adapter.scan(['src'], { config: 'p/ci' });
  assert(capturedArgs.includes('--config'), 'args should include --config flag');
  assert(capturedArgs.includes('p/ci'), 'args should include config value as separate element');
  const configIndex = capturedArgs.indexOf('--config');
  assert.strictEqual(capturedArgs[configIndex + 1], 'p/ci', 'config should be a separate arg');
  console.log('config-arg-safety: ok');

  restoreRunCommandSecure();

  // 7. normalizeFinding boundary — missing extra.message and metadata.severity
  adapter = getAdapter();
  const noMessage = adapter.normalizeFinding({
    check_id: 'x',
    path: 'a.py',
    start: { line: 1 },
    end: { line: 1 },
    extra: { lines: 'legacy fallback line' },
  });
  assert.strictEqual(noMessage.message, 'legacy fallback line', 'missing message should fallback to extra.lines');
  assert.strictEqual(noMessage.severity, 'medium', 'missing severity should fallback to medium');
  console.log('normalize-finding-missing-fields: ok');

  // 8. normalizeFinding boundary — missing check_id
  const noId = adapter.normalizeFinding({
    path: 'b.py',
    start: { line: 2 },
    end: { line: 3 },
    extra: { message: 'm' },
  });
  assert.strictEqual(noId.ruleId, 'unknown', 'missing check_id should fallback to unknown');
  console.log('normalize-finding-missing-id: ok');

  // 9. normalizeFinding severity mapping case-insensitivity
  const mixedCase = adapter.normalizeFinding({
    check_id: 'y',
    path: 'c.py',
    start: { line: 1 },
    end: { line: 1 },
    extra: { metadata: { severity: 'High' } },
  });
  assert.strictEqual(mixedCase.severity, 'high', 'severity should be case-insensitive');
  console.log('normalize-finding-case-insensitive-severity: ok');

  console.log('\nAll SemgrepAdapter boundary tests passed');
}

main().catch((err) => {
  restoreRunCommandSecure();
  console.error('Test failed:', err.message);
  process.exit(1);
});
