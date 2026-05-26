#!/usr/bin/env node
// @contract

const assert = require('assert');
const { runCliRaw } = require('./test-helpers');

function testFormatJsonOutputsJson() {
  const result = runCliRaw(['audit-file', '--file', 'src/services/container.js', '--format', 'json', '--quiet']);
  assert.strictEqual(result.status, 0, 'audit-file --format json should exit 0');
  const stdout = result.stdout || '';
  assert(stdout.trim().startsWith('{'), '--format json should output JSON object, not markdown');
  const data = JSON.parse(stdout);
  assert.strictEqual(data.ok, true, 'JSON should have ok: true');
  assert(data.file, 'JSON should have file field');
}

function testFormatJsonOnAuditSummary() {
  const result = runCliRaw(['audit-summary', '--format', 'json', '--quiet']);
  assert.strictEqual(result.status, 0, 'audit-summary --format json should exit 0');
  const stdout = result.stdout || '';
  assert(stdout.trim().startsWith('{'), '--format json should output JSON object');
  const data = JSON.parse(stdout);
  assert.strictEqual(data.ok, true, 'JSON should have ok: true');
}

function testFormatJsonOnAuditDiff() {
  const result = runCliRaw(['audit-diff', '--format', 'json', '--quiet']);
  assert.strictEqual(result.status, 0, 'audit-diff --format json should exit 0');
  const stdout = result.stdout || '';
  assert(stdout.trim().startsWith('{'), '--format json should output JSON object');
  const data = JSON.parse(stdout);
  assert.strictEqual(data.ok, true, 'JSON should have ok: true');
}

function main() {
  testFormatJsonOutputsJson();
  testFormatJsonOnAuditSummary();
  testFormatJsonOnAuditDiff();
  console.log('cli-format-json-test.js: all passed');
}

main();
