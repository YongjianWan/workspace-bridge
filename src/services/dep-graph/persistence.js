/**
 * GraphPersistence — Precompute serialization / deserialization and
 * post-build event registration.
 *
 * Extracted from orchestrator.js to break the dep-graph.js ↔ orchestrator.js
 * circular dependency. Both modules now depend on this shared substrate
 * instead of each other.
 */
const fs = require('fs');
const { extractRoutes } = require('./framework-patterns');

const DEFAULT_AFFECTED_TESTS_DEPTH = 3; // default search depth for precomputing affected tests

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
      const AGGREGATE_KEYS = ['deadExports', 'unresolved', 'cycles', 'stats'];
      for (const key of AGGREGATE_KEYS) {
        if (cache[key] !== undefined) {
          aggregateRows.push({
            key,
            data: JSON.stringify(cache[key]),
            version: analyzer.getAggregateVersion(),
            fileCount: graphSize,
          });
        }
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
        impactRadius: JSON.stringify(data.impactRadius),
        version: analyzer._impactVersion,
      });
    }
    if (impactRecords.length > 0) {
      depGraph.cache.savePrecomputedImpact(impactRecords);
    }

    // Wave 9-2: extract and persist route declarations
    if (depGraph.cache.saveRoutes) {
      const allRoutes = [];
      for (const [filePath, info] of depGraph.graph) {
        if (!info.frameworkHint) continue;
        try {
          const content = await fs.promises.readFile(filePath, 'utf-8');
          const routes = extractRoutes(filePath, content);
          for (const r of routes) {
            allRoutes.push({ file: filePath, ...r });
          }
        } catch {
          // skip files that can't be read
        }
      }
      if (allRoutes.length > 0) {
        depGraph.cache.saveRoutes(allRoutes);
      }
    }

    // Save metrics
    if (depGraph.cache.saveMetrics) {
      const metrics = [];
      if (analyzer._pageRanks) {
        for (const [file, val] of analyzer._pageRanks) {
          metrics.push({ file, dimension: 'pagerank', value: val });
        }
      }
      const agg = analyzer.getAggregateCache();
      if (agg && agg.hotspots) {
        for (const h of agg.hotspots) {
          const fullPath = depGraph.normalizeFilePath(h.file);
          metrics.push({ file: fullPath, dimension: 'hotspot_score', value: h.score });
          let riskVal = 0;
          if (h.risk === 'high') riskVal = 3;
          else if (h.risk === 'medium') riskVal = 2;
          else if (h.risk === 'low') riskVal = 1;
          metrics.push({ file: fullPath, dimension: 'risk_score', value: riskVal });
        }
      }
      if (depGraph.cache.coChanges && depGraph.cache.coChanges.fileChangeCounts) {
        for (const [file, count] of depGraph.cache.coChanges.fileChangeCounts) {
          const fullPath = depGraph.normalizeFilePath(file);
          metrics.push({ file: fullPath, dimension: 'cochange_score', value: count });
        }
      }
      if (metrics.length > 0) {
        depGraph.cache.saveMetrics(metrics);
      }
    }

    // Save test_map
    if (depGraph.cache.saveTestMap) {
      const testMaps = [];
      for (const [filePath] of depGraph.graph) {
        if (depGraph.isTestLikeFile(filePath)) continue;
        const tests = depGraph.analyzer.findAffectedTests(filePath, DEFAULT_AFFECTED_TESTS_DEPTH, { includeHeuristic: true });
        for (const t of tests) {
          const testFileNormalized = depGraph.normalizeFilePath(t.file);
          let signal = 'import';
          if (t.source === 'heuristic') signal = 'heuristic';
          else if (t.source === 'mention') signal = 'mention';

          testMaps.push({
            source: filePath,
            testFile: testFileNormalized,
            signal,
            distance: t.distance,
          });
        }
      }
      if (testMaps.length > 0) {
        depGraph.cache.saveTestMap(testMaps);
      }
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

    const metricsRows = depGraph.cache.loadMetrics();
    if (metricsRows && metricsRows.length > 0) {
      const ok = depGraph.analyzer.injectPrecomputedMetrics(metricsRows);
      if (!depGraph.quiet && ok) {
        // eslint-disable-next-line no-console
        console.error('[Persistence] Precomputed metrics restored for', metricsRows.length, 'entries');
      }
    }

    const testMapRows = depGraph.cache.loadTestMap();
    if (testMapRows && testMapRows.length > 0) {
      const ok = depGraph.analyzer.injectPrecomputedTestMap(testMapRows);
      if (!depGraph.quiet && ok) {
        // eslint-disable-next-line no-console
        console.error('[Persistence] Precomputed test map restored for', testMapRows.length, 'entries');
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
