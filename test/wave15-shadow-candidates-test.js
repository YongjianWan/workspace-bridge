#!/usr/bin/env node
// @contract — shadowCandidatesFor 规则校验

const assert = require('assert');
const path = require('path');
const { shadowCandidatesFor } = require('../src/services/dep-graph/shadow-candidates');

function testSameBasenameDifferentExt() {
  const file = path.resolve('/mock/foo.ts');
  const candidates = shadowCandidatesFor(file);

  // Should contain other JS/TS extensions
  assert.ok(candidates.includes(path.resolve('/mock/foo.js')));
  assert.ok(candidates.includes(path.resolve('/mock/foo.tsx')));
  assert.ok(candidates.includes(path.resolve('/mock/foo.d.ts')));
  // Should not contain itself
  assert.ok(!candidates.includes(file));
}

function testBareFileShadowsDirectoryIndex() {
  const file = path.resolve('/mock/foo.ts');
  const candidates = shadowCandidatesFor(file);

  // Should contain directory index patterns
  assert.ok(candidates.includes(path.resolve('/mock/foo/index.ts')));
  assert.ok(candidates.includes(path.resolve('/mock/foo/index.js')));
}

function testDirectoryIndexShadowsBareFile() {
  const file = path.resolve('/mock/foo/index.ts');
  const candidates = shadowCandidatesFor(file);

  // Should contain the parent bare files
  assert.ok(candidates.includes(path.resolve('/mock/foo.ts')));
  assert.ok(candidates.includes(path.resolve('/mock/foo.js')));
  assert.ok(candidates.includes(path.resolve('/mock/foo.tsx')));
}

function testNonJsExtReturnsEmpty() {
  const file = path.resolve('/mock/foo.py');
  const candidates = shadowCandidatesFor(file);
  assert.strictEqual(candidates.length, 0, 'Python files should yield zero shadow candidates');
}

function testDtsInputShadowCandidates() {
  const file = path.resolve('/mock/foo.d.ts');
  const candidates = shadowCandidatesFor(file);

  // Should contain other JS/TS extensions
  assert.ok(candidates.includes(path.resolve('/mock/foo.js')));
  assert.ok(candidates.includes(path.resolve('/mock/foo.ts')));
  assert.ok(candidates.includes(path.resolve('/mock/foo.tsx')));
  // Should not contain itself
  assert.ok(!candidates.includes(file));
}

/* -------------------------------------------------------------------------- */
// Runner
/* -------------------------------------------------------------------------- */
const tests = [
  testSameBasenameDifferentExt,
  testBareFileShadowsDirectoryIndex,
  testDirectoryIndexShadowsBareFile,
  testNonJsExtReturnsEmpty,
  testDtsInputShadowCandidates,
];

let passed = 0;
let failed = 0;
for (const t of tests) {
  try {
    t();
    passed++;
    console.log(`  PASS ${t.name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL ${t.name}: ${err.message}`);
  }
}
console.log(`\n${passed}/${tests.length} passed`);
if (failed > 0) process.exit(1);

