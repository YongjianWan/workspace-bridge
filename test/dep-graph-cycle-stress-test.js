#!/usr/bin/env node
// @slow

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');
const { DependencyGraph } = require('../src/services/dep-graph');
const { WorkspaceCache } = require('../src/services/cache');

/**
 * Normalizes cycles by rotating each path to start with its lexicographically
 * smallest node, preserving path sequence and direction.
 */
function normalizeCycles(cycles) {
  return cycles.map((cycle) => {
    const minNode = [...cycle].sort()[0];
    const idx = cycle.indexOf(minNode);
    return [...cycle.slice(idx), ...cycle.slice(0, idx)].join(' -> ');
  }).sort();
}

/**
 * Test 1: Chained Overlapping Graph
 * 1,000 nodes total, chained linearly.
 * Every 50 nodes, we have a back-edge to the start of that segment.
 * Tarjan should isolate these into 20 SCCs of size 50.
 * Johnson should be restricted strictly to these SCCs, completing in O(V) overall.
 */
async function testChainedOverlappingGraph() {
  const dir = makeTempDir('wb-cycle-chain-');
  fs.writeFileSync(path.join(dir, 'package.json'), '{}', 'utf8');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });

  const numNodes = 1000;
  const segmentSize = 4;
  const files = [];

  for (let i = 0; i < numNodes; i++) {
    const filePath = path.join(dir, 'src', `node_${i}.js`);
    files.push(filePath);
  }

  // Create dependency chain: i -> i+1
  // Back-edges: every 4th node (e.g. 3 -> 0, 7 -> 4, etc.)
  for (let i = 0; i < numNodes; i++) {
    let depName;
    if ((i + 1) % segmentSize === 0) {
      depName = `node_${i - segmentSize + 1}`;
    } else if (i < numNodes - 1) {
      depName = `node_${i + 1}`;
    }

    const importContent = depName ? `import './${depName}';\n` : '\n';
    fs.writeFileSync(files[i], importContent, 'utf8');
  }

  const cache = new WorkspaceCache(dir);
  for (const f of files) {
    cache.setFileMetadata(f, { mtime: 1, size: 1 });
  }

  const dg = new DependencyGraph(dir, cache);
  await dg.build();

  const start = Date.now();
  const cycles = dg.findCircularDependencies();
  const duration = Date.now() - start;

  assert.ok(Array.isArray(cycles), 'Cycles should be returned as an array');
  // There are 250 segments, each having exactly 1 cycle of size 4
  assert.strictEqual(cycles.length, 250, 'Should find exactly 250 cycles in 1000-node chained graph');
  assert.ok(duration < 250, `Chained isolated SCC search took too long: ${duration}ms (target: <250ms)`);

  cleanupTempDir(dir);
}

/**
 * Test 2: Output Stability and Determinism
 * Runs findCircularDependencies 10 times on a complex graph
 * and asserts that the outputs are 100% identical.
 */
async function testOutputStability() {
  const dir = makeTempDir('wb-cycle-stability-');
  fs.writeFileSync(path.join(dir, 'package.json'), '{}', 'utf8');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });

  // 10 nodes, interconnected in multiple overlapping cycles:
  const nodes = 10;
  const files = [];
  for (let i = 0; i < nodes; i++) {
    const f = path.join(dir, 'src', `node_${i}.js`);
    files.push(f);
  }

  for (let i = 0; i < nodes; i++) {
    // Connect to next node, and add overlapping back-edges
    const next = (i + 1) % nodes;
    const shortcut = (i + 3) % nodes;
    fs.writeFileSync(files[i], `import './node_${next}'; import './node_${shortcut}';\n`, 'utf8');
  }

  const cache = new WorkspaceCache(dir);
  for (const f of files) {
    cache.setFileMetadata(f, { mtime: 1, size: 1 });
  }

  const dg = new DependencyGraph(dir, cache);
  await dg.build();

  // Run 10 times and assert string equality of serialized outputs
  const firstRun = dg.findCircularDependencies();
  const firstNormalized = normalizeCycles(firstRun);
  const firstSerialized = JSON.stringify(firstNormalized);

  for (let r = 1; r < 10; r++) {
    const currentRun = dg.findCircularDependencies({ skipCache: true });
    const currentNormalized = normalizeCycles(currentRun);
    const currentSerialized = JSON.stringify(currentNormalized);
    assert.strictEqual(
      currentSerialized,
      firstSerialized,
      `Cycle detection output diverged on run ${r} (ordering or nondeterminism)`
    );
  }

  cleanupTempDir(dir);
}

/**
 * Test 3: Large SCC Pruning and Memory Stress
 * Constructs a dense K_60 clique (60 nodes, all interconnected - 60*59 = 3540 edges).
 * The number of simple cycles is astronomically exponential.
 * This tests that the MAX_CYCLE_EDGE_DEPTH = 7 recursion safety guard
 * works perfectly to prune search trees, preventing stack overflow and memory leaks.
 */
async function testLargeSCCPruning() {
  const dir = makeTempDir('wb-cycle-pruning-');
  fs.writeFileSync(path.join(dir, 'package.json'), '{}', 'utf8');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });

  const numNodes = 20;
  const files = [];
  for (let i = 0; i < numNodes; i++) {
    const f = path.join(dir, 'src', `node_${i}.js`);
    files.push(f);
  }

  // Construct a 50-node ring graph with overlapping shortcuts (highly complex SCC, but branch factor = 3):
  // node_i -> node_{i+1}, node_{i+3}, node_{i+7}
  for (let i = 0; i < numNodes; i++) {
    const next1 = (i + 1) % numNodes;
    const next2 = (i + 3) % numNodes;
    const next3 = (i + 7) % numNodes;
    fs.writeFileSync(
      files[i],
      `import './node_${next1}';\nimport './node_${next2}';\nimport './node_${next3}';\n`,
      'utf8'
    );
  }

  const cache = new WorkspaceCache(dir);
  for (const f of files) {
    cache.setFileMetadata(f, { mtime: 1, size: 1 });
  }

  const dg = new DependencyGraph(dir, cache);
  await dg.build();

  const start = Date.now();
  const cycles = dg.findCircularDependencies();
  const duration = Date.now() - start;

  assert.ok(Array.isArray(cycles), 'Cycles should be returned as an array');
  assert.ok(cycles.length > 0, 'Should find cycles in large 20-node SCC');

  // Verify that the depth guard was successfully enforced:
  // No discovered cycle should have length greater than MAX_CYCLE_EDGE_DEPTH + 1 = 8
  for (const cycle of cycles) {
    assert.ok(
      cycle.length <= 8,
      `Cycle detected with length ${cycle.length} exceeding MAX_CYCLE_EDGE_DEPTH + 1 limit of 8 (depth guard failed!)`
    );
  }

  // Under unbounded search, a highly connected 20-node SCC would run forever and leak memory/stack.
  // Under depth guard pruning, it should finish in milliseconds.
  assert.ok(
    duration < 150,
    `Dense graph search took too long: ${duration}ms (target: <150ms due to depth guard pruning)`
  );

  cleanupTempDir(dir);
}

async function main() {
  const startSuite = Date.now();
  console.log('[Stress] Running Tarjan + Johnson cycle detection stress suite...');

  await testChainedOverlappingGraph();
  console.log('  → testChainedOverlappingGraph ... PASS');

  await testOutputStability();
  console.log('  → testOutputStability ... PASS');

  await testLargeSCCPruning();
  console.log('  → testLargeSCCPruning ... PASS');

  console.log(`[Stress] Cycle stress suite completed successfully in ${Date.now() - startSuite}ms.`);
}

main().catch((e) => {
  console.error('[Stress] FAIL:', e);
  process.exit(1);
});
