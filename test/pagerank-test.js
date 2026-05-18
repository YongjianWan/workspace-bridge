#!/usr/bin/env node
/**
 * PageRank algorithm tests — ported from qartez-mcp graph/pagerank.rs
 */
const assert = require('assert');
const { computePageRank } = require('../src/services/dep-graph/pagerank');

function testEmptyGraph() {
  const ranks = computePageRank([], []);
  assert.strictEqual(ranks.size, 0, 'empty graph should return empty map');
}

function testTriangleEqualRank() {
  const nodes = ['a', 'b', 'c'];
  const edges = [['a', 'b'], ['b', 'c'], ['c', 'a']];
  const ranks = computePageRank(nodes, edges);

  const r1 = ranks.get('a');
  const r2 = ranks.get('b');
  const r3 = ranks.get('c');
  assert(Math.abs(r1 - r2) < 0.001, 'triangle nodes should have roughly equal rank');
  assert(Math.abs(r2 - r3) < 0.001, 'triangle nodes should have roughly equal rank');
  assert(Math.abs(r1 - 1.0 / 3.0) < 0.01, 'each node should be near 1/3');
}

function testStarGraphHubHighest() {
  const nodes = ['hub', 'leaf1', 'leaf2', 'leaf3', 'leaf4'];
  const edges = [['leaf1', 'hub'], ['leaf2', 'hub'], ['leaf3', 'hub'], ['leaf4', 'hub']];
  const ranks = computePageRank(nodes, edges);

  const hubRank = ranks.get('hub');
  for (const leaf of ['leaf1', 'leaf2', 'leaf3', 'leaf4']) {
    assert(hubRank > ranks.get(leaf), `hub should have higher rank than ${leaf}`);
  }
}

function testDisconnectedNodesGetBaseRank() {
  const nodes = ['a', 'b', 'c'];
  const edges = [];
  const ranks = computePageRank(nodes, edges);

  const expected = 1.0 / 3.0;
  for (const id of nodes) {
    const actual = ranks.get(id);
    assert(Math.abs(actual - expected) < 0.001, `disconnected node ${id} should have rank ~${expected}, got ${actual}`);
  }
}

function testConvergenceSimpleGraph() {
  const nodes = ['a', 'b'];
  const edges = [['a', 'b'], ['b', 'a']];
  const ranks = computePageRank(nodes, edges, { damping: 0.85, iterations: 1000, epsilon: 1e-10 });

  assert(Math.abs(ranks.get('a') - ranks.get('b')) < 1e-10, 'symmetric graph should converge to equal ranks');
}

function testDanglingNodes() {
  const nodes = ['a', 'b', 'c'];
  const edges = [['a', 'b'], ['b', 'c']];
  const ranks = computePageRank(nodes, edges);

  for (const id of nodes) {
    assert(ranks.get(id) > 0.0, `node ${id} should have positive rank`);
  }
  // Node c receives rank from b, and redistributes its dangling rank
  assert(ranks.get('c') > ranks.get('a'), 'node c (sink) should have more rank than node a (source)');
}

function testRanksSumToOne() {
  const nodes = ['a', 'b', 'c', 'd'];
  const edges = [['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'a'], ['a', 'c']];
  const ranks = computePageRank(nodes, edges);

  let total = 0.0;
  for (const id of nodes) {
    total += ranks.get(id);
  }
  assert(Math.abs(total - 1.0) < 0.001, `ranks should sum to ~1.0, got ${total}`);
}

function testWarmStartConvergesInOneIteration() {
  const nodes = ['a', 'b', 'c'];
  const edges = [['a', 'b'], ['b', 'c'], ['c', 'a']];
  const cold = computePageRank(nodes, edges);
  const warm = computePageRank(nodes, edges, { iterations: 1 }, cold);

  for (const id of nodes) {
    assert(Math.abs(cold.get(id) - warm.get(id)) < 0.001, `warm-start with converged input should match cold result for ${id}`);
  }
}

function testWarmStartFallsBackOnZeroRanks() {
  const nodes = ['a', 'b', 'c'];
  const edges = [['a', 'b'], ['b', 'c'], ['c', 'a']];
  const zeros = new Map(nodes.map((id) => [id, 0.0]));
  const cold = computePageRank(nodes, edges);
  const fromZeros = computePageRank(nodes, edges, {}, zeros);

  for (const id of nodes) {
    assert(Math.abs(cold.get(id) - fromZeros.get(id)) < 0.001, `zero prev_ranks should produce the same result as cold start for ${id}`);
  }
}

function testWarmStartHandlesNewNode() {
  const nodes = ['a', 'b', 'c'];
  const edges = [['a', 'b'], ['b', 'c'], ['c', 'a']];
  const cold = computePageRank(nodes, edges);

  const nodesExtended = ['a', 'b', 'c', 'd'];
  const edgesExtended = [['a', 'b'], ['b', 'c'], ['c', 'a'], ['c', 'd']];
  const warm = computePageRank(nodesExtended, edgesExtended, {}, cold);

  let total = 0.0;
  for (const id of nodesExtended) {
    total += warm.get(id);
  }
  assert(Math.abs(total - 1.0) < 0.01, `ranks should still sum to ~1.0 after adding a new node, got ${total}`);
  assert(warm.get('d') > 0.0, 'new node should have positive rank');
}

function main() {
  testEmptyGraph();
  testTriangleEqualRank();
  testStarGraphHubHighest();
  testDisconnectedNodesGetBaseRank();
  testConvergenceSimpleGraph();
  testDanglingNodes();
  testRanksSumToOne();
  testWarmStartConvergesInOneIteration();
  testWarmStartFallsBackOnZeroRanks();
  testWarmStartHandlesNewNode();
  console.log('pagerank-test.js: all passed');
}

main();
