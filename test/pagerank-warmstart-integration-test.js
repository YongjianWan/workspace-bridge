#!/usr/bin/env node
/**
 * PageRank warm-start integration test — verifies GraphAnalyzer.save/load
 * from cache and produces stable results across cold/warm runs.
 */
const assert = require('assert');
const { GraphAnalyzer } = require('../src/services/dep-graph');

function testGraphAnalyzerColdStart() {
  const cache = {
    pageRanks: new Map(),
    savePageRanks(ranks) {
      this.pageRanks = ranks;
      return true;
    }
  };
  const dg = {
    graph: new Map([
      ['a', { imports: ['b', 'c'] }],
      ['b', { imports: ['c'] }],
      ['c', { imports: ['a'] }],
    ]),
    normalizeFilePath: (p) => p,
    bus: { emit: () => {}, on: () => {} },
    cache,
  };
  const analyzer = new GraphAnalyzer(dg);
  analyzer.computePageRank();

  assert(analyzer._pageRanks instanceof Map, 'should store ranks as Map');
  assert(analyzer._pageRanks.size === 3, 'should have 3 ranks');
  assert(analyzer._pageRanks.get('a') > 0, 'a should have positive rank');
  assert.strictEqual(cache.pageRanks.size, 3, 'cache should receive persisted ranks');
}

function testGraphAnalyzerWarmStartReusesCache() {
  // First run: cold start
  const cache = {
    pageRanks: new Map(),
    savePageRanks(ranks) {
      this.pageRanks = ranks;
      return true;
    }
  };
  const dg1 = {
    graph: new Map([
      ['a', { imports: ['b'] }],
      ['b', { imports: ['c'] }],
      ['c', { imports: ['a'] }],
    ]),
    normalizeFilePath: (p) => p,
    bus: { emit: () => {}, on: () => {} },
    cache,
  };
  const analyzer1 = new GraphAnalyzer(dg1);
  analyzer1.computePageRank();
  const coldRanks = analyzer1._pageRanks;

  // Second run: warm start with same graph
  const dg2 = {
    graph: new Map([
      ['a', { imports: ['b'] }],
      ['b', { imports: ['c'] }],
      ['c', { imports: ['a'] }],
    ]),
    normalizeFilePath: (p) => p,
    bus: { emit: () => {}, on: () => {} },
    cache,
  };
  const analyzer2 = new GraphAnalyzer(dg2);
  analyzer2.computePageRank();
  const warmRanks = analyzer2._pageRanks;

  for (const id of ['a', 'b', 'c']) {
    const c = coldRanks.get(id);
    const w = warmRanks.get(id);
    assert(Math.abs(c - w) < 1e-10, `warm-start rank for ${id} should match cold: cold=${c} warm=${w}`);
  }
}

function testGraphAnalyzerWarmStartHandlesNewNode() {
  // First run: 3-node graph
  const cache = {
    pageRanks: new Map(),
    savePageRanks(ranks) {
      this.pageRanks = ranks;
      return true;
    }
  };
  const dg1 = {
    graph: new Map([
      ['a', { imports: ['b'] }],
      ['b', { imports: ['c'] }],
      ['c', { imports: ['a'] }],
    ]),
    normalizeFilePath: (p) => p,
    bus: { emit: () => {}, on: () => {} },
    cache,
  };
  const analyzer1 = new GraphAnalyzer(dg1);
  analyzer1.computePageRank();

  // Second run: 4-node graph (prev ranks have 3 nodes, new node 'd')
  const dg2 = {
    graph: new Map([
      ['a', { imports: ['b', 'd'] }],
      ['b', { imports: ['c'] }],
      ['c', { imports: ['a'] }],
      ['d', { imports: ['a'] }],
    ]),
    normalizeFilePath: (p) => p,
    bus: { emit: () => {}, on: () => {} },
    cache,
  };
  const analyzer2 = new GraphAnalyzer(dg2);
  analyzer2.computePageRank();

  assert(analyzer2._pageRanks.size === 4, 'should handle new node gracefully');
  assert(analyzer2._pageRanks.get('d') > 0, 'new node d should have positive rank');
  let total = 0;
  for (const [, r] of analyzer2._pageRanks) {
    total += r;
  }
  assert(Math.abs(total - 1.0) < 0.01, `ranks should sum to ~1.0, got ${total}`);
}

function testGraphAnalyzerWithoutCache() {
  const dg = {
    graph: new Map([
      ['a', { imports: ['b'] }],
      ['b', { imports: ['a'] }],
    ]),
    normalizeFilePath: (p) => p,
    bus: { emit: () => {}, on: () => {} },
    cache: null,
  };
  const analyzer = new GraphAnalyzer(dg);
  analyzer.computePageRank();

  assert(analyzer._pageRanks.size === 2, 'should work without cache');
}

function main() {
  testGraphAnalyzerColdStart();
  testGraphAnalyzerWarmStartReusesCache();
  testGraphAnalyzerWarmStartHandlesNewNode();
  testGraphAnalyzerWithoutCache();
  console.log('pagerank-warmstart-integration-test.js: all passed');
}

main();
