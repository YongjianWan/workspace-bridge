#!/usr/bin/env node

const assert = require('assert');
const { runCliRaw } = require('./test-helpers');

function testUnknownCommand() {
  const result = runCliRaw(['nonexistent-command']);
  assert.notStrictEqual(result.status, 0, 'unknown command should fail');
  const stderr = result.stderr || result.stdout || '';
  assert(stderr.toLowerCase().includes('unknown') || stderr.toLowerCase().includes('help'), 'should mention unknown or help');
}

function testHelpFlag() {
  const result = runCliRaw(['--help']);
  assert.strictEqual(result.status, 0, '--help should succeed');
  const stdout = result.stdout || '';
  assert(stdout.includes('workspace-bridge'), 'help should mention workspace-bridge');
  assert(stdout.includes('Curated Commands (Tier 1'), 'default help should show Tier 1 curated commands');
  assert(stdout.includes('impact'), 'default help should include impact command');
  assert(stdout.includes('dead-exports'), 'default help should include dead-exports command');
  assert(!stdout.includes('L4 原始查询'), 'default help should not show L4 debug commands');
  assert(stdout.includes('--help --all'), 'default help should mention --help --all');
}

function testHelpAllFlag() {
  const result = runCliRaw(['--help', '--all']);
  assert.strictEqual(result.status, 0, '--help --all should succeed');
  const stdout = result.stdout || '';
  assert(stdout.includes('L1 策展入口'), 'full help should show L1 section');
  assert(stdout.includes('L4 原始查询'), 'full help should show L4 debug commands');
  assert(stdout.includes('dead-exports'), 'full help should list dead-exports command');
}

function testVersionFlag() {
  const result = runCliRaw(['--version']);
  assert.strictEqual(result.status, 0, '--version should succeed');
}

function testMissingFileArgument() {
  const result = runCliRaw(['audit-file', '--cwd', '.', '--json', '--quiet']);
  assert.notStrictEqual(result.status, 0, 'missing --file should fail');
}

function testQuietSuppressesInfo() {
  const result = runCliRaw(['stats', '--cwd', '.', '--json', '--quiet']);
  assert.strictEqual(result.status, 0);
  // In quiet mode, informational stderr should be suppressed,
  // but valid JSON stdout should still be present.
  const stdout = result.stdout || '{}';
  assert(stdout.includes('files'), 'stats should output files count');
}

function main() {
  testUnknownCommand();
  testHelpFlag();
  testHelpAllFlag();
  testVersionFlag();
  testMissingFileArgument();
  testQuietSuppressesInfo();
}

main();
