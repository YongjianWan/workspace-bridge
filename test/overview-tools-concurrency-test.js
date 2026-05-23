#!/usr/bin/env node

const assert = require('assert');
const { buildHotspots } = require('../src/tools/overview-assembler');

async function testHotspotConcurrencyLimit() {
  let maxConcurrent = 0;
  let currentConcurrent = 0;

  const mockHistoryProvider = async () => {
    currentConcurrent++;
    if (currentConcurrent > maxConcurrent) {
      maxConcurrent = currentConcurrent;
    }
    // Simulate async work (git log latency)
    await new Promise((r) => setTimeout(r, 30));
    currentConcurrent--;
    return { ok: true, historyRisk: { level: 'low', signals: [] } };
  };

  // Create 20 fake mainline files
  const mainlineFiles = Array.from({ length: 20 }, (_, i) => `/fake/path/file${i}.js`);

  const mockDepGraph = {
    _displayPath: (f) => f,
    getDependents: () => [],
    getDependencies: () => [],
    getFrameworkHint: () => null,
    projectContext: {
      classifyFile: () => ({ fileRole: 'library' }),
    },
  };

  const results = await buildHotspots('/fake/root', mockDepGraph, mainlineFiles, mockHistoryProvider);

  // All 20 files should be processed (some may be filtered out by score threshold)
  assert.strictEqual(results.length <= 20, true, 'should return at most 20 results');

  // Max concurrent history provider calls should never exceed GIT_LOG_CONCURRENCY (8)
  assert(maxConcurrent <= 8, `max concurrent ${maxConcurrent} should be <= 8`);

  // All calls should have completed (currentConcurrent back to 0)
  assert.strictEqual(currentConcurrent, 0, 'all provider calls should have completed');
}

async function testHotspotBatchOrdering() {
  const callOrder = [];

  const mockHistoryProvider = async (root, file) => {
    callOrder.push(file);
    await new Promise((r) => setTimeout(r, 5));
    return { ok: true, historyRisk: { level: 'low', signals: [] } };
  };

  const mainlineFiles = ['/a.js', '/b.js', '/c.js'];
  const mockDepGraph = {
    _displayPath: (f) => f,
    getDependents: () => [],
    getDependencies: () => [],
    getFrameworkHint: () => null,
    projectContext: {
      classifyFile: () => ({ fileRole: 'library' }),
    },
  };

  const results = await buildHotspots('/fake/root', mockDepGraph, mainlineFiles, mockHistoryProvider);

  // With only 3 files and concurrency 8, everything runs in one batch
  // and ordering should be preserved.
  assert.deepStrictEqual(callOrder, mainlineFiles, 'call order should match input order within a batch');
}

async function main() {
  await testHotspotConcurrencyLimit();
  await testHotspotBatchOrdering();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
