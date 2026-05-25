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

  // Test 5: corrupted .workspace-bridge.json must exit 1 and show config_error
  {
    const fs = require('fs');
    const path = require('path');
    const configPath = path.join(__dirname, '..', '.workspace-bridge.json');
    const backupPath = configPath + '.bak-test';
    let backedUp = false;
    if (fs.existsSync(configPath)) {
      fs.copyFileSync(configPath, backupPath);
      backedUp = true;
    }
    try {
      fs.writeFileSync(configPath, '{invalid json,', 'utf8');
      const result = runCliRaw(['audit-summary', '--cwd', '.', '--json']);
      assert.strictEqual(result.status, 1, 'should exit 1 for corrupted config json');
      const out = result.stdout + result.stderr;
      assert(out.includes('config_error') || out.includes('Invalid JSON in config file'), 'error should mention config_error or invalid JSON');
    } finally {
      if (backedUp) {
        fs.copyFileSync(backupPath, configPath);
        fs.unlinkSync(backupPath);
      } else if (fs.existsSync(configPath)) {
        fs.unlinkSync(configPath);
      }
    }
  }

  // Test 6: --format json must output valid JSON and map to parsed.json
  {
    const result = runCliRaw(['stats', '--cwd', '.', '--format', 'json', '--quiet']);
    assert.strictEqual(result.status, 0, 'should exit 0 for format json');
    const json = JSON.parse(result.stdout);
    assert.strictEqual(json.ok, true, 'format json stdout should be valid JSON');
    assert(json.stats.files > 0, 'stats should contain files count');
  }

  // Test 7: audit-summary must redirect to overview data and be backward compatible
  {
    const result = runCliRaw(['audit-summary', '--cwd', '.', '--json', '--quiet']);
    assert.strictEqual(result.status, 0, 'should exit 0 for audit-summary');
    const json = JSON.parse(result.stdout);
    assert.strictEqual(json.ok, true, 'audit-summary should succeed');
    assert(json.deadExports, 'should contain deadExports');
    assert(json.unresolved, 'should contain unresolved');
    assert(json.cycles, 'should contain cycles');
    assert(json.health, 'should contain backward-compatible health check');
    assert.strictEqual(json.health.healthScore, '5/5', 'healthScore should be compatible');
  }

  // Test 8: audit-overview must contain all panoramic findings
  {
    const result = runCliRaw(['audit-overview', '--cwd', '.', '--json', '--quiet']);
    assert.strictEqual(result.status, 0, 'should exit 0 for audit-overview');
    const json = JSON.parse(result.stdout);
    assert.strictEqual(json.ok, true, 'audit-overview should succeed');
    assert(json.hotspots, 'should contain hotspots');
    assert(json.stability, 'should contain stability');
    assert(json.deadExports, 'should contain deadExports');
    assert(json.unresolved, 'should contain unresolved');
    assert(json.cycles, 'should contain cycles');
  }
}

main();

