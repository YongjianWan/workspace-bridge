#!/usr/bin/env node
// @contract

const assert = require('assert');
const { runCliRaw } = require('./test-helpers');

function testReplImpactJson() {
  const result = runCliRaw(['repl', '--eval', 'impact src/services/container.js', '--json', '--quiet']);
  assert.strictEqual(result.status, 0, 'repl impact --json should exit 0');
  const data = JSON.parse(result.stdout);
  assert.strictEqual(data.ok, true, 'should have ok: true');
  assert(typeof data.result === 'object', 'result should be object');
  assert(typeof data.result.impactCount === 'number', 'result should have impactCount');
  assert(Array.isArray(data.result.impact), 'result should have impact array');
}

function testReplAffectedTestsJson() {
  const result = runCliRaw(['repl', '--eval', 'affected-tests src/services/container.js', '--json', '--quiet']);
  assert.strictEqual(result.status, 0, 'repl affected-tests --json should exit 0');
  const data = JSON.parse(result.stdout);
  assert.strictEqual(data.ok, true, 'should have ok: true');
  assert(typeof data.result === 'object', 'result should be object');
  assert(typeof data.result.affectedTestsCount === 'number', 'result should have affectedTestsCount');
  assert(Array.isArray(data.result.affectedTests), 'result should have affectedTests array');
}

function testReplIssuesJson() {
  const result = runCliRaw(['repl', '--eval', 'issues', '--json', '--quiet']);
  assert.strictEqual(result.status, 0, 'repl issues --json should exit 0');
  const data = JSON.parse(result.stdout);
  assert.strictEqual(data.ok, true, 'should have ok: true');
  assert(typeof data.result === 'object', 'result should be object');
  assert(typeof data.result.severity === 'string', 'result should have severity');
}

function testReplMultiCommandJson() {
  const result = runCliRaw(['repl', '--eval', 'stats; issues', '--json', '--quiet']);
  assert.strictEqual(result.status, 0, 'repl multi-command --json should exit 0');
  const data = JSON.parse(result.stdout);
  assert.strictEqual(data.ok, true, 'should have ok: true');
  assert(Array.isArray(data.results), 'should have results array');
  assert.strictEqual(data.results.length, 2, 'should have 2 command results');
  
  assert.strictEqual(data.results[0].command, 'stats');
  assert.strictEqual(data.results[0].ok, true);
  assert(data.results[0].result.files > 0);
  
  assert.strictEqual(data.results[1].command, 'issues');
  assert.strictEqual(data.results[1].ok, true);
  assert.strictEqual(typeof data.results[1].result.severity, 'string');
}

function testReplMultiCommandHuman() {
  const result = runCliRaw(['repl', '--eval', 'stats; help', '--quiet']);
  assert.strictEqual(result.status, 0, 'repl multi-command human should exit 0');
  assert(result.stdout.includes('=== Command: stats ==='), 'should contain first command header');
  assert(result.stdout.includes('=== Command: help ==='), 'should contain second command header');
  assert(result.stdout.includes('totalImports:'), 'should print stats output');
  assert(result.stdout.includes('exit / quit'), 'should print help output');
}

function main() {
  testReplImpactJson();
  testReplAffectedTestsJson();
  testReplIssuesJson();
  testReplMultiCommandJson();
  testReplMultiCommandHuman();
  console.log('repl-json-test.js: all passed');
}

main();
