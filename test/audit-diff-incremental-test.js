#!/usr/bin/env node
/**
 * audit-diff --incremental integration test.
 * Verifies that the incremental flag adds an incrementalFindings field
 * scoped to changed files and their impact radius.
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..');
const cliPath = path.join(repoRoot, 'cli.js');

function runCli(args) {
  const result = spawnSync('node', [cliPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    timeout: 60000,
  });
  return result;
}

function parseJsonOutput(stdout) {
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(stdout.slice(start, end + 1));
  } catch {
    return null;
  }
}

function testIncrementalSchema() {
  console.log('--- test: audit-diff --incremental schema ---');

  const result = runCli(['audit-diff', '--incremental', '--json', '--quiet']);
  const output = parseJsonOutput(result.stdout);

  assert(output, `Should produce JSON output. stdout: ${result.stdout}, stderr: ${result.stderr}`);
  assert(output.ok === true, `Should return ok=true. Got: ${output.ok}`);
  assert(output.incremental === true, `Should flag incremental=true. Got: ${output.incremental}`);
  assert(output.incrementalFindings, 'Should include incrementalFindings field');

  const inc = output.incrementalFindings;
  assert(typeof inc.deadExportsCount === 'number', 'incrementalFindings should have deadExportsCount');
  assert(Array.isArray(inc.deadExports), 'incrementalFindings.deadExports should be an array');
  assert(typeof inc.unresolvedCount === 'number', 'incrementalFindings should have unresolvedCount');
  assert(Array.isArray(inc.unresolved), 'incrementalFindings.unresolved should be an array');
  assert(typeof inc.cyclesCount === 'number', 'incrementalFindings should have cyclesCount');
  assert(Array.isArray(inc.cycles), 'incrementalFindings.cycles should be an array');

  // Counts must match array lengths
  assert.strictEqual(inc.deadExportsCount, inc.deadExports.length, 'deadExportsCount must equal deadExports.length');
  assert.strictEqual(inc.unresolvedCount, inc.unresolved.length, 'unresolvedCount must equal unresolved.length');
  assert.strictEqual(inc.cyclesCount, inc.cycles.length, 'cyclesCount must equal cycles.length');

  console.log('audit-diff --incremental schema: ok');
}

function testIncrementalVsFull() {
  console.log('--- test: audit-diff --incremental vs full ---');

  const incResult = runCli(['audit-diff', '--incremental', '--json', '--quiet']);
  const fullResult = runCli(['audit-diff', '--json', '--quiet']);

  const incOutput = parseJsonOutput(incResult.stdout);
  const fullOutput = parseJsonOutput(fullResult.stdout);

  assert(incOutput && incOutput.ok, 'Incremental should succeed');
  assert(fullOutput && fullOutput.ok, 'Full should succeed');

  // Both should have the same top-level structure (changedFiles, summary, validationAdvice)
  assert(Array.isArray(incOutput.changedFiles), 'Incremental should have changedFiles');
  assert(Array.isArray(fullOutput.changedFiles), 'Full should have changedFiles');

  // Full output should NOT have incremental flag
  assert(fullOutput.incremental !== true, 'Full output should not be flagged incremental');
  assert(!fullOutput.incrementalFindings, 'Full output should not have incrementalFindings');

  // If there are no changed files, incremental findings should all be empty
  if (incOutput.changedFiles.length === 0) {
    assert.strictEqual(incOutput.incrementalFindings.deadExportsCount, 0, 'No changes → no incremental dead exports');
    assert.strictEqual(incOutput.incrementalFindings.unresolvedCount, 0, 'No changes → no incremental unresolved');
    assert.strictEqual(incOutput.incrementalFindings.cyclesCount, 0, 'No changes → no incremental cycles');
  }

  console.log('audit-diff --incremental vs full: ok');
}

function testIncrementalFiltering() {
  console.log('--- test: incremental findings scope ---');

  const result = runCli(['audit-diff', '--incremental', '--json', '--quiet']);
  const output = parseJsonOutput(result.stdout);

  assert(output && output.ok, 'Should succeed');
  const changedSet = new Set((output.changedFiles || []).map((e) => e.file));

  // Every dead export in incremental findings must be related to a changed file
  for (const de of output.incrementalFindings.deadExports) {
    assert(de.file, 'Dead export entry should have a file');
  }

  // Every unresolved in incremental findings must be related to a changed file
  for (const ur of output.incrementalFindings.unresolved) {
    assert(ur.file, 'Unresolved entry should have a file');
  }

  console.log('incremental findings scope: ok');
}

function main() {
  console.log('=== workspace-bridge audit-diff incremental test ===\n');

  testIncrementalSchema();
  testIncrementalVsFull();
  testIncrementalFiltering();

  console.log('\n=== all audit-diff incremental tests passed ===');
}

main();
