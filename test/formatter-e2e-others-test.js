#!/usr/bin/env node
/**
 * Formatter end-to-end tests — file-level, health, stats, and error formatters.
 * Uses in-process runner (shared ServiceContainer) for speed.
 * The final error-path case still spawns a fresh process to verify exit codes.
 */
const assert = require('assert');
const { runCliTextInProcess, runCliRaw, shutdownSharedContainer } = require('./test-helpers');

async function testAuditFileHuman() {
  const out = await runCliTextInProcess(['audit-file', '--file', 'cli.js', '--cwd', '.', '--quiet', '--format', 'human']);
  assert(out.includes('file:'), 'should show file');
  assert(out.includes('severity:'), 'should show severity');
  assert(out.includes('impactCount:'), 'should show impactCount');
  assert(out.includes('affectedTestsCount:'), 'should show affectedTestsCount');
}

async function testHealthHuman() {
  const out = await runCliTextInProcess(['health', '--cwd', '.', '--quiet', '--format', 'human']);
  assert(out.includes('workspaceRoot:'), 'should show workspaceRoot');
  assert(out.includes('healthScore:'), 'should show healthScore');
  assert(out.includes('packageManager:'), 'should show packageManager');
  assert(out.includes('ci:'), 'should show ci');
  assert(out.includes('tests:'), 'should show tests');
}

async function testStatsHuman() {
  const out = await runCliTextInProcess(['stats', '--cwd', '.', '--quiet', '--format', 'human']);
  // stats outputs key: value lines
  const lines = out.split('\n').filter(Boolean);
  assert(lines.length >= 1, 'should have at least one stat line');
  assert(lines.every((l) => l.includes(':')), 'every line should be key: value format');
}

function testFormatHumanErrorFallback() {
  const result = runCliRaw(['impact', '--file', 'nonexistent-file.js', '--cwd', '.', '--quiet', '--format', 'human']);
  assert.notStrictEqual(result.status, 0, 'error command should have non-zero exit');
  assert(result.stdout.startsWith('Error:'), 'error output should start with Error:');
}

async function main() {
  try {
    await testAuditFileHuman();
    await testHealthHuman();
    await testStatsHuman();
    testFormatHumanErrorFallback();
    console.log('formatter-e2e-others-test.js: all passed');
  } finally {
    shutdownSharedContainer();
  }
}

main();
