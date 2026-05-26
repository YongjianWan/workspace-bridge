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

function main() {
  testReplImpactJson();
  testReplAffectedTestsJson();
  testReplIssuesJson();
  console.log('repl-json-test.js: all passed');
}

main();
