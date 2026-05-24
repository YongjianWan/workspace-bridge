#!/usr/bin/env node
/**
 * @slow
 * Precomputed hotspot/stability integration test.
 * Verifies that hotspot/stability are computed on-demand by buildProjectOverview
 * and cached for reuse (precompute-on-demand).
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { makeTempDir, cleanupTempDir, runInDir } = require('./test-helpers');
const { ServiceContainer } = require('../src/services/container');
const { buildProjectOverview } = require('../src/tools/overview-tools');

function writeFile(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

async function testPrecomputeHotspotsAndStability() {
  const tempRoot = makeTempDir('wb-precompute-');
  try {
    writeFile(tempRoot, 'package.json', JSON.stringify({ name: 'ph-test', version: '1.0.0', main: 'src/app.js' }, null, 2));
    writeFile(tempRoot, 'src/util.js', 'export function helper() { return 1; }\n');
    // Create enough dependents so util.js has coupling > 1 and becomes a hotspot
    writeFile(tempRoot, 'src/a.js', 'import { helper } from "./util";\nexport function runA() { return helper(); }\n');
    writeFile(tempRoot, 'src/b.js', 'import { helper } from "./util";\nexport function runB() { return helper(); }\n');
    writeFile(tempRoot, 'src/c.js', 'import { helper } from "./util";\nexport function runC() { return helper(); }\n');
    writeFile(tempRoot, 'src/app.test.js', 'import { runA } from "./a";\nexport function t() { return runA(); }\n');

    runInDir('git', ['init'], tempRoot);
    runInDir('git', ['config', 'user.email', 'test@example.com'], tempRoot);
    runInDir('git', ['config', 'user.name', 'Test User'], tempRoot);
    runInDir('git', ['add', '.'], tempRoot);
    runInDir('git', ['commit', '-m', 'init'], tempRoot);

    const container = new ServiceContainer({ quiet: true });
    await container.initialize(tempRoot);

    const analyzer = container.depGraph.analyzer;
    assert(analyzer._aggregateCache, 'aggregate cache should exist after build');
    // Precompute-on-demand: hotspots/stability are NOT computed during initialize()
    assert.strictEqual(analyzer._aggregateCache.hotspots, null, 'hotspots should be null before first query');
    assert.strictEqual(analyzer._aggregateCache.stability, null, 'stability should be null before first query');

    // buildProjectOverview triggers on-demand precompute on first call
    const result1 = await buildProjectOverview({ quiet: true }, container);
    assert(result1.ok, 'audit-overview should succeed');
    assert(Array.isArray(result1.hotspots), 'result should have hotspots');
    assert(Array.isArray(result1.stability), 'result should have stability');
    assert(Array.isArray(analyzer._aggregateCache.hotspots), 'hotspots should be cached after first query');
    assert(Array.isArray(analyzer._aggregateCache.stability), 'stability should be cached after first query');

    // Verify cache reuse:
    // buildHotspotVisualizationData sorts hotspots in-place via .sort().
    // If cache was reused, _aggregateCache.hotspots === hotspots variable,
    // so .sort() mutates the cache array. Second call will see already-sorted
    // array and not change it — the reference stays stable.
    const cacheRefBefore = analyzer._aggregateCache.hotspots;
    const result2 = await buildProjectOverview({ quiet: true }, container);
    const cacheRefAfter = analyzer._aggregateCache.hotspots;
    assert.strictEqual(cacheRefBefore, cacheRefAfter, 'cache hotspots array should not be replaced on second call');

    await container.shutdown();
  } finally {
    cleanupTempDir(tempRoot);
  }
}

async function testPrecomputeWithEmptyGraph() {
  const tempRoot = makeTempDir('wb-precompute-empty-');
  try {
    writeFile(tempRoot, 'package.json', JSON.stringify({ name: 'empty', version: '1.0.0' }, null, 2));

    runInDir('git', ['init'], tempRoot);
    runInDir('git', ['config', 'user.email', 'test@example.com'], tempRoot);
    runInDir('git', ['config', 'user.name', 'Test User'], tempRoot);
    runInDir('git', ['add', '.'], tempRoot);
    runInDir('git', ['commit', '-m', 'init'], tempRoot);

    const container = new ServiceContainer({ quiet: true });
    await container.initialize(tempRoot);

    const analyzer = container.depGraph.analyzer;
    // Empty graph: hotspots/stability may be empty arrays or null
    assert(analyzer._aggregateCache, 'aggregate cache should exist');

    await container.shutdown();
  } finally {
    cleanupTempDir(tempRoot);
  }
}

async function main() {
  await testPrecomputeHotspotsAndStability();
  await testPrecomputeWithEmptyGraph();
  console.log('precompute-hotspot-test.js: all passed');
}

main();
