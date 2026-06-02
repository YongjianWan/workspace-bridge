/**
 * GraphPersistence — Precompute serialization / deserialization and
 * post-build event registration.
 *
 * Extracted from orchestrator.js to break the dep-graph.js ↔ orchestrator.js
 * circular dependency. Both modules now depend on this shared substrate
 * instead of each other.
 */

/**
 * Register the 'graph:built' event listener that coordinates post-build
 * precompute + persistence. Previously inline in DependencyGraph constructor.
 * @param {DependencyGraph} depGraph
 */
function registerGraphBuiltHandler(depGraph) {
  depGraph.bus.on('graph:built', async () => {
    depGraph.analyzer.precomputeAggregates();
    depGraph.analyzer.precomputeImpact();
    await savePrecomputed(depGraph);
  });
}

/**
 * D7-D8: Serialize and save precomputed aggregates + impact to SQLite.
 * Moved from dep-graph.js to orchestrator.js as part of O4/A-2 decoupling.
 * @param {DependencyGraph} depGraph
 */
async function savePrecomputed(depGraph) {
  if (!depGraph.cache) return;
  try {
    const analyzer = depGraph.analyzer;
    const graphSize = depGraph.graph.size;

    // Save aggregates
    const aggregateRows = [];
    const cache = analyzer.getAggregateCache();
    if (cache) {
      if (cache.deadExports !== undefined) {
        aggregateRows.push({
          key: 'deadExports',
          data: JSON.stringify(cache.deadExports),
          version: analyzer.getAggregateVersion(),
          fileCount: graphSize,
        });
      }
      if (cache.unresolved !== undefined) {
        aggregateRows.push({
          key: 'unresolved',
          data: JSON.stringify(cache.unresolved),
          version: analyzer.getAggregateVersion(),
          fileCount: graphSize,
        });
      }
      if (cache.cycles !== undefined) {
        aggregateRows.push({
          key: 'cycles',
          data: JSON.stringify(cache.cycles),
          version: analyzer.getAggregateVersion(),
          fileCount: graphSize,
        });
      }
      if (cache.stats !== undefined) {
        aggregateRows.push({
          key: 'stats',
          data: JSON.stringify(cache.stats),
          version: analyzer.getAggregateVersion(),
          fileCount: graphSize,
        });
      }
    }
    if (aggregateRows.length > 0) {
      depGraph.cache.savePrecomputedAggregates(aggregateRows);
    }

    // Save impact
    const impactRecords = [];
    for (const [file, data] of analyzer._impactCache) {
      impactRecords.push({
        file,
        directDeps: data.directDeps,
        transitiveDeps: data.transitiveDeps,
        directDependents: data.directDependents,
        transitiveDependents: data.transitiveDependents,
        affectedTests: JSON.stringify(data.affectedTests),
        version: analyzer._impactVersion,
      });
    }
    if (impactRecords.length > 0) {
      depGraph.cache.savePrecomputedImpact(impactRecords);
    }
  } catch (e) {
    if (process.env.DEBUG) {
      // eslint-disable-next-line no-console
      console.error('[Persistence] savePrecomputed failed:', e.message);
    }
  }
}

/**
 * Restore precomputed aggregates + impact from cache into the analyzer.
 * Previously inline in loadGraph().
 * @param {DependencyGraph} depGraph
 */
function restorePrecomputed(depGraph) {
  if (!depGraph.cache) return;
  try {
    const aggregateRows = depGraph.cache.loadPrecomputedAggregates();
    if (aggregateRows && aggregateRows.length > 0) {
      const ok = depGraph.analyzer.injectPrecomputedAggregates(aggregateRows, depGraph.graph.size);
      if (!depGraph.quiet && ok) {
        // eslint-disable-next-line no-console
        console.error('[Persistence] Precomputed aggregates restored from cache');
      }
    }

    const impactRows = depGraph.cache.loadPrecomputedImpact();
    if (impactRows && impactRows.length > 0) {
      const ok = depGraph.analyzer.injectPrecomputedImpact(impactRows, depGraph.graph.size);
      if (!depGraph.quiet && ok) {
        // eslint-disable-next-line no-console
        console.error('[Persistence] Precomputed impact restored for', impactRows.length, 'files');
      }
    }
  } catch (e) {
    if (process.env.DEBUG) {
      // eslint-disable-next-line no-console
      console.error('[Persistence] Precomputed load failed:', e.message);
    }
  }
}

module.exports = {
  registerGraphBuiltHandler,
  savePrecomputed,
  restorePrecomputed,
};
