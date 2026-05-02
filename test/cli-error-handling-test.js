#!/usr/bin/env node
/**
 * CLI error handling test
 * Covers HIGH-priority fixes for fatal error visibility and formatHuman crashes.
 */
const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..');
const cliPath = path.join(repoRoot, 'cli.js');

function runCli(args) {
  return spawnSync('node', [cliPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function main() {
  console.log('=== CLI Error Handling Test ===\n');

  // Test 1: audit-file with missing file — human mode should show error, not crash
  {
    const result = runCli(['audit-file', '--cwd', '.', '--file', 'definitely-missing-xyz.js']);
    assert.strictEqual(result.status, 1, 'should exit 1 for missing file');
    assert(result.stdout.includes('Error:'), 'human output should contain Error:');
    assert(result.stdout.includes('File not found:'), 'human output should mention file not found');
    console.log('Test 1 (audit-file missing file human mode): ok');
  }

  // Test 2: audit-file with missing file — JSON mode should return structured error
  {
    const result = runCli(['audit-file', '--cwd', '.', '--file', 'definitely-missing-xyz.js', '--json']);
    assert.strictEqual(result.status, 1, 'should exit 1 for missing file (json)');
    const json = JSON.parse(result.stdout);
    assert.strictEqual(json.ok, false, 'json ok should be false');
    assert(json.error.includes('File not found'), 'json error should mention file not found');
    console.log('Test 2 (audit-file missing file json mode): ok');
  }

  // Test 3: --quiet must not suppress fatal errors
  {
    const result = runCli(['audit-file', '--cwd', '.', '--file', 'definitely-missing-xyz.js', '--quiet']);
    assert.strictEqual(result.status, 1, 'should exit 1 with quiet');
    assert(result.stdout.includes('Error:'), 'quiet mode should still surface error');
    assert(result.stderr === '', 'quiet mode should suppress stderr diagnostic logs');
    console.log('Test 3 (quiet mode preserves fatal errors): ok');
  }

  console.log('\ncli-error-handling-test: ok');
}

main();
