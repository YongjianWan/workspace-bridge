#!/usr/bin/env node

const assert = require('assert');
const {
  buildUnresolvedRecommendation,
  buildCycleRecommendation,
  buildDeadExportRecommendation,
} = require('../src/cli/formatters/recommendation-engine');

function testNullWhenCountZero() {
  assert.strictEqual(buildUnresolvedRecommendation(0, null, null), null);
  assert.strictEqual(buildCycleRecommendation(0, null), null);
  assert.strictEqual(buildDeadExportRecommendation(0, null, null), null);
  console.log('null-when-count-zero: ok');
}

function testUnresolvedGeneral() {
  const rec = buildUnresolvedRecommendation(3, null, null);
  assert.strictEqual(rec, 'Inspect 3 unresolved imports first; they can indicate broken code paths or unsupported alias resolution.');
  const recSingle = buildUnresolvedRecommendation(1, null, null);
  assert.strictEqual(recSingle, 'Inspect 1 unresolved import first; they can indicate broken code paths or unsupported alias resolution.');
  console.log('unresolved-general: ok');
}

function testUnresolvedAliasVue() {
  const fp = { count: 8, total: 10, primaryReason: 'alias-unresolved' };
  const stack = { node: { framework: 'vue' } };
  const rec = buildUnresolvedRecommendation(10, fp, stack);
  assert(rec.includes('80% are alias/Vue extension omissions'));
  assert(rec.includes('vite.config.js'));
  console.log('unresolved-alias-vue: ok');
}

function testUnresolvedAliasNonVue() {
  const fp = { count: 8, total: 10, primaryReason: 'alias-unresolved' };
  const stack = { node: { framework: 'react' } };
  const rec = buildUnresolvedRecommendation(10, fp, stack);
  assert(rec.includes('80% are alias false positives'));
  assert(rec.includes('tsconfig.json'));
  console.log('unresolved-alias-non-vue: ok');
}

function testCycleGeneral() {
  const rec = buildCycleRecommendation(2, null);
  assert.strictEqual(rec, 'Break 2 dependency cycles before making broad refactors.');
  const recSingle = buildCycleRecommendation(1, null);
  assert.strictEqual(recSingle, 'Break 1 dependency cycle before making broad refactors.');
  console.log('cycle-general: ok');
}

function testCycleVue() {
  const stack = { node: { framework: 'vue' } };
  const rec = buildCycleRecommendation(3, stack);
  assert(rec.includes('store→router→view'));
  assert(rec.includes('intentional design patterns'));
  console.log('cycle-vue: ok');
}

function testDeadExportGeneral() {
  const rec = buildDeadExportRecommendation(2, null, null);
  assert(rec.includes('review as candidates'));
  const recSingle = buildDeadExportRecommendation(1, null, null);
  assert(recSingle.includes('review as candidates'));
  console.log('dead-export-general: ok');
}

function testDeadExportFpVue() {
  const fp = { count: 6, total: 10, primaryReason: 'vue-page-implicit' };
  const stack = { node: { framework: 'vue' }, profile: 'node-first' };
  const rec = buildDeadExportRecommendation(10, fp, stack);
  assert(rec.includes('60% are likely false positives'));
  assert(rec.includes('Vue global components, directives, or lazy-loaded routes'));
  console.log('dead-export-fp-vue: ok');
}

function testDeadExportFpJava() {
  const fp = { count: 5, total: 10, primaryReason: 'graph-unreliable' };
  const stack = { profile: 'java-first' };
  const rec = buildDeadExportRecommendation(10, fp, stack);
  assert(rec.includes('50% are likely false positives'));
  assert(rec.includes('Spring Boot framework entry classes'));
  console.log('dead-export-fp-java: ok');
}

function testDeadExportFpOther() {
  const fp = { count: 7, total: 10, primaryReason: 'missing-extension' };
  const stack = { profile: 'python-first' };
  const rec = buildDeadExportRecommendation(10, fp, stack);
  assert(rec.includes('70% are likely false positives'));
  assert(rec.includes('missing-extension'));
  console.log('dead-export-fp-other: ok');
}

function testDeadExportFpBelowThreshold() {
  const fp = { count: 3, total: 10, primaryReason: 'vue-page-implicit' };
  const stack = { node: { framework: 'vue' } };
  const rec = buildDeadExportRecommendation(10, fp, stack);
  assert(rec.includes('review as candidates'));
  assert(!rec.includes('false positives'));
  console.log('dead-export-fp-below-threshold: ok');
}

function testDeadExportFpScaffold() {
  const fp = { count: 7, total: 10, primaryReason: 'scaffold-ruoyi' };
  const stack = { profile: 'java-first' };
  const rec = buildDeadExportRecommendation(10, fp, stack);
  assert(rec.includes('70% are likely false positives'));
  assert(rec.includes('RuoYi / Vue Admin'));
  console.log('dead-export-fp-scaffold: ok');
}

function main() {
  testNullWhenCountZero();
  testUnresolvedGeneral();
  testUnresolvedAliasVue();
  testUnresolvedAliasNonVue();
  testCycleGeneral();
  testCycleVue();
  testDeadExportGeneral();
  testDeadExportFpVue();
  testDeadExportFpJava();
  testDeadExportFpOther();
  testDeadExportFpBelowThreshold();
  testDeadExportFpScaffold();
  console.log('recommendation-engine-test: ok');
}

main();
