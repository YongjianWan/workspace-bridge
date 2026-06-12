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

function testUnsupportedExtReturnsEmpty() {
  const file = path.resolve('/mock/foo.java');
  const candidates = shadowCandidatesFor(file);
  assert.strictEqual(candidates.length, 0, 'Unsupported extensions should yield zero shadow candidates');
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

function testPythonPyToPyi() {
  const file = path.resolve('/mock/foo.py');
  const candidates = shadowCandidatesFor(file);

  assert.ok(candidates.includes(path.resolve('/mock/foo.pyi')), '.py should shadow .pyi');
  assert.ok(!candidates.includes(file), '.py should not contain itself');
  assert.ok(
    !candidates.some((c) => c.endsWith('.ts') || c.endsWith('.js')),
    '.py should not shadow JS/TS files'
  );
  assert.ok(
    !candidates.includes(path.resolve('/mock/foo/index.py')),
    '.py should not produce directory index candidates'
  );
}

function testPythonPyiToPy() {
  const file = path.resolve('/mock/foo.pyi');
  const candidates = shadowCandidatesFor(file);

  assert.ok(candidates.includes(path.resolve('/mock/foo.py')), '.pyi should shadow .py');
  assert.ok(!candidates.includes(file), '.pyi should not contain itself');
}

function testCHeaderHToSources() {
  const file = path.resolve('/mock/foo.h');
  const candidates = shadowCandidatesFor(file);

  assert.ok(candidates.includes(path.resolve('/mock/foo.c')), '.h should shadow .c');
  assert.ok(candidates.includes(path.resolve('/mock/foo.cpp')), '.h should shadow .cpp');
  assert.ok(candidates.includes(path.resolve('/mock/foo.cc')), '.h should shadow .cc');
  assert.ok(candidates.includes(path.resolve('/mock/foo.hpp')), '.h should shadow .hpp');
  assert.ok(!candidates.includes(file), '.h should not contain itself');
}

function testCppSourceToSiblings() {
  const file = path.resolve('/mock/foo.cpp');
  const candidates = shadowCandidatesFor(file);

  assert.ok(candidates.includes(path.resolve('/mock/foo.h')), '.cpp should shadow .h');
  assert.ok(candidates.includes(path.resolve('/mock/foo.hpp')), '.cpp should shadow .hpp');
  assert.ok(candidates.includes(path.resolve('/mock/foo.c')), '.cpp should shadow .c');
  assert.ok(candidates.includes(path.resolve('/mock/foo.cc')), '.cpp should shadow .cc');
  assert.ok(!candidates.includes(file), '.cpp should not contain itself');
}

function testHppSourceToSiblings() {
  const file = path.resolve('/mock/bar.hpp');
  const candidates = shadowCandidatesFor(file);

  assert.ok(candidates.includes(path.resolve('/mock/bar.h')), '.hpp should shadow .h');
  assert.ok(candidates.includes(path.resolve('/mock/bar.c')), '.hpp should shadow .c');
  assert.ok(candidates.includes(path.resolve('/mock/bar.cpp')), '.hpp should shadow .cpp');
  assert.ok(candidates.includes(path.resolve('/mock/bar.cc')), '.hpp should shadow .cc');
}

/* -------------------------------------------------------------------------- */
// Runner
/* -------------------------------------------------------------------------- */
const tests = [
  testSameBasenameDifferentExt,
  testBareFileShadowsDirectoryIndex,
  testDirectoryIndexShadowsBareFile,
  testUnsupportedExtReturnsEmpty,
  testDtsInputShadowCandidates,
  testPythonPyToPyi,
  testPythonPyiToPy,
  testCHeaderHToSources,
  testCppSourceToSiblings,
  testHppSourceToSiblings,
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
