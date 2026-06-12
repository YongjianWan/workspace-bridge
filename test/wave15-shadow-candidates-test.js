#!/usr/bin/env node
// @contract — shadowCandidatesFor 规则校验

const assert = require('assert');
const path = require('path');
const { shadowCandidatesFor } = require('../src/services/dep-graph/shadow-candidates');
const { parseVue, parseSvelte } = require('../src/services/dep-graph/parsers');

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

function testVueToScriptCompanions() {
  const file = path.resolve('/mock/Component.vue');
  const candidates = shadowCandidatesFor(file);

  assert.ok(candidates.includes(path.resolve('/mock/Component.ts')), '.vue should shadow .ts');
  assert.ok(candidates.includes(path.resolve('/mock/Component.js')), '.vue should shadow .js');
  assert.ok(!candidates.includes(file), '.vue should not contain itself');
  assert.ok(
    !candidates.some((c) => c.endsWith('.svelte') || c.endsWith('.tsx')),
    '.vue should not shadow Svelte or TSX files'
  );
  assert.ok(
    !candidates.includes(path.resolve('/mock/Component/index.ts')),
    '.vue should not produce directory index candidates'
  );
}

function testVueScriptToVue() {
  const file = path.resolve('/mock/Component.ts');
  const candidates = shadowCandidatesFor(file);

  assert.ok(candidates.includes(path.resolve('/mock/Component.vue')), '.ts should shadow .vue');
  assert.ok(candidates.includes(path.resolve('/mock/Component.js')), '.ts should shadow .js');
  assert.ok(candidates.includes(path.resolve('/mock/Component.svelte')), '.ts should shadow .svelte');
  assert.ok(!candidates.includes(file), '.ts should not contain itself');
}

function testSvelteToScriptCompanions() {
  const file = path.resolve('/mock/App.svelte');
  const candidates = shadowCandidatesFor(file);

  assert.ok(candidates.includes(path.resolve('/mock/App.ts')), '.svelte should shadow .ts');
  assert.ok(candidates.includes(path.resolve('/mock/App.js')), '.svelte should shadow .js');
  assert.ok(!candidates.includes(file), '.svelte should not contain itself');
  assert.ok(
    !candidates.some((c) => c.endsWith('.vue') || c.endsWith('.jsx')),
    '.svelte should not shadow Vue or JSX files'
  );
  assert.ok(
    !candidates.includes(path.resolve('/mock/App/index.ts')),
    '.svelte should not produce directory index candidates'
  );
}

function testSvelteScriptToSvelte() {
  const file = path.resolve('/mock/App.js');
  const candidates = shadowCandidatesFor(file);

  assert.ok(candidates.includes(path.resolve('/mock/App.svelte')), '.js should shadow .svelte');
  assert.ok(candidates.includes(path.resolve('/mock/App.vue')), '.js should shadow .vue');
  assert.ok(candidates.includes(path.resolve('/mock/App.ts')), '.js should shadow .ts');
  assert.ok(!candidates.includes(file), '.js should not contain itself');
}

function testVueFunctionRecordFields() {
  const source = `
<template><div></div></template>
<script>
function dispatch(x) {
  switch (x) {
    case 1: break;
    case 2: break;
    case 3: break;
  }
}
</script>
`;
  const parsed = parseVue(source, 'Component.vue');
  const fn = parsed.functionRecords.find((f) => f.name === 'dispatch');
  assert(fn, 'Vue parser should produce dispatch functionRecord');
  assert(fn.fingerprint, 'Vue functionRecord should carry fingerprint');
  assert.strictEqual(fn.maxArms, 3, 'Vue functionRecord.maxArms should be lifted from fingerprint');
  assert.strictEqual(fn.branchCount, fn.fingerprint.branchCount, 'Vue functionRecord.branchCount should be lifted from fingerprint');
}

function testSvelteFunctionRecordFields() {
  const source = `
<script>
function dispatch(x) {
  switch (x) {
    case 1: break;
    case 2: break;
    case 3: break;
  }
}
</script>
`;
  const parsed = parseSvelte(source, 'App.svelte');
  const fn = parsed.functionRecords.find((f) => f.name === 'dispatch');
  assert(fn, 'Svelte parser should produce dispatch functionRecord');
  assert(fn.fingerprint, 'Svelte functionRecord should carry fingerprint');
  assert.strictEqual(fn.maxArms, 3, 'Svelte functionRecord.maxArms should be lifted from fingerprint');
  assert.strictEqual(fn.branchCount, fn.fingerprint.branchCount, 'Svelte functionRecord.branchCount should be lifted from fingerprint');
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
  testVueToScriptCompanions,
  testVueScriptToVue,
  testSvelteToScriptCompanions,
  testSvelteScriptToSvelte,
  testVueFunctionRecordFields,
  testSvelteFunctionRecordFields,
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
