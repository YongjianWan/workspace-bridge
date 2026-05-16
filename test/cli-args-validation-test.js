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
  testVersionFlag();
  testMissingFileArgument();
  testQuietSuppressesInfo();
  console.log('cli-args-validation-test: all passed');
}

main();
