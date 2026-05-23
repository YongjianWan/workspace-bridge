#!/usr/bin/env node
// @contract
/**
 * CLI error handling test
 * Covers HIGH-priority fixes for fatal error visibility and formatHuman crashes.
 */
const assert = require('assert');
const { runCliRaw } = require('./test-helpers');

function main() {

  // Test 1: audit-file with missing file — human mode should show error, not crash
  {
    const result = runCliRaw(['audit-file', '--cwd', '.', '--file', 'definitely-missing-xyz.js', '--format', 'human']);
    assert.strictEqual(result.status, 1, 'should exit 1 for missing file');
    assert(result.stdout.includes('Error:'), 'human output should contain Error:');
    assert(result.stdout.includes('File not found:'), 'human output should mention file not found');
  }

  // Test 2: audit-file with missing file — JSON mode should return structured error
  {
    const result = runCliRaw(['audit-file', '--cwd', '.', '--file', 'definitely-missing-xyz.js', '--json']);
    assert.strictEqual(result.status, 1, 'should exit 1 for missing file (json)');
    const json = JSON.parse(result.stdout);
    assert.strictEqual(json.ok, false, 'json ok should be false');
    assert(json.error.includes('File not found'), 'json error should mention file not found');
  }

  // Test 3: --quiet must not suppress fatal errors
  {
    const result = runCliRaw(['audit-file', '--cwd', '.', '--file', 'definitely-missing-xyz.js', '--quiet', '--format', 'human']);
    assert.strictEqual(result.status, 1, 'should exit 1 with quiet');
    assert(result.stdout.includes('Error:'), 'quiet mode should still surface error');
    assert(result.stderr === '', 'quiet mode should suppress stderr diagnostic logs');
  }

  // Test 4: Unknown command should exit 2 and show Unknown command error
  {
    const result = runCliRaw(['unknown-cmd-xyz']);
    assert.strictEqual(result.status, 2, 'should exit 2 for unknown command');
    const out = result.stdout + result.stderr;
    assert(out.includes('Unknown command: unknown-cmd-xyz'), 'should surface unknown command error');
  }
}

main();

