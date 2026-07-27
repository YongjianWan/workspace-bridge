/**
 * GraphLoader — Load dependency graph from persisted SQLite edges.
 *
 * Extracted from dep-graph.js as part of Route A-2 cleanup.
 * Encapsulates staleness guard, metadata validation, graph reconstruction,
 * orphan edge handling, and post-load precompute restoration.
 */
const { restorePrecomputed } = require('./persistence');
const { CACHE_VERSION } = require('../../config/constants');

/**
 * Load graph + reverseGraph from persisted edges in SQLite.
 * Skips buildReverseGraph() and post-process if edges are fresh.
 * Returns true on success, false to fall back to build().
 *
 * @param {DependencyGraph} depGraph
 * @param {Object} [options={}]
 * @param {boolean} [options.skipChangeCheck=false]
 * @returns {boolean}
 */
function loadGraph(depGraph, options = {}) {
  // Staleness guard: if files changed on disk since last edge save,
  // fall back to full build() to ensure consistency.
  // When skipChangeCheck is true, caller is responsible for incremental
  // update after load (container.js hybrid path).
  if (!options.skipChangeCheck) {
    try {
      const changeCheck = depGraph.cache.checkFileChanges();
      if (changeCheck.changed) {
        if (!depGraph.quiet) {
          console.error(`[DepGraph] Files changed on disk (${changeCheck.changedFiles.length} files), skipping loadGraph`);
        }
        return false;
      }
    } catch {
      return false;
    }
  }

  const edges = depGraph.cache.loadEdges();
  if (!edges || edges.length === 0) {
    return false;
  }

  // Validate persisted edge metadata for coarse staleness detection.
  // edgeMeta is the ONLY place CACHE_VERSION is enforced on the warm path:
  // GraphDB.loadAll returns null on a version mismatch but deletes nothing, and
  // loadEdges/loadTestMap/loadMetrics/loadRoutes/loadPrecomputedImpact all read
  // their tables raw. So "no metadata" must mean "don't trust the tables" —
  // treating it as "nothing to check" would load an arbitrary-version graph.
  const edgeMeta = depGraph.cache.edgeMeta;
  if (!edgeMeta) return false;
  if (edgeMeta.cacheVersion !== CACHE_VERSION) return false;
  if (edgeMeta.fileMetadataCount !== depGraph.cache.fileMetadata.size) return false;
  if (edgeMeta.parseResultsCount !== depGraph.cache.parseResults.size) return false;

  // Degraded parse entries (external AST toolchain was missing, e.g. no
  // javalang) are never trusted from persistence: the toolchain may have
  // been fixed since, and mtime/hash cannot see that. Fall back to build(),
  // which re-parses them via GraphBuilder._isParseCacheUsable and upgrades
  // the entries to AST on success.
  for (const [, result] of depGraph.cache.parseResults) {
    if (result.parseMode === 'regex' && result.parseModeReason === 'regex-fallback') {
      if (!depGraph.quiet) {
        console.error('[DepGraph] Cache contains regex-fallback parse results (degraded toolchain); rebuilding instead of loading');
      }
      return false;
    }
  }

  depGraph.graph.clear();
  depGraph.reverseGraph.clear();
  depGraph.bus.emit('graph:updated', { fullRebuild: true });

  // Rebuild edge map and reverseGraph from persisted edges
  const edgeMap = new Map();
  for (const edge of edges) {
    if (edge.edgeType !== 'import') continue; // 过滤非 import 边，不加入主依赖关系图
    if (!edgeMap.has(edge.source)) {
      edgeMap.set(edge.source, []);
    }
    edgeMap.get(edge.source).push(edge.target);

    if (!depGraph.reverseGraph.has(edge.target)) {
      depGraph.reverseGraph.set(edge.target, []);
    }
    const dependents = depGraph.reverseGraph.get(edge.target);
    if (!dependents.includes(edge.source)) {
      dependents.push(edge.source);
    }
  }

  // Restore graph nodes from parseResults, using edges for imports
  for (const [filePath, result] of depGraph.cache.parseResults) {
    const meta = depGraph.cache.getFileMetadata(filePath);
    depGraph.graph.set(filePath, {
      originalPath: meta?.originalPath || result.originalPath || filePath,
      imports: edgeMap.get(filePath) || result.imports || [],
      exports: result.exports || [],
      importRecords: result.importRecords || [],
      exportRecords: result.exportRecords || [],
      functionRecords: result.functionRecords || [],
      parseMode: result.parseMode || 'none',
      parseModeReason: result.parseModeReason || '',
      confidence: result.confidence || 'medium',
      package: result.package || null,
      frameworkHint: result.frameworkHint || null,
      routes: result.routes || [],
    });
  }

  // Handle orphan edges (files in edges but missing from parseResults)
  for (const [source, targets] of edgeMap) {
    if (!depGraph.graph.has(source)) {
      depGraph.graph.set(source, {
        originalPath: source,
        imports: targets,
        exports: [],
        importRecords: targets.map((t) => ({ source: '<edge-only>', resolved: t })),
        exportRecords: [],
        functionRecords: [],
        parseMode: 'none',
        parseModeReason: 'edge-only',
        confidence: 'low',
        package: null,
      });
    }
  }

  if (!depGraph.quiet) {
    console.error(`[DepGraph] Loaded graph from edges: ${depGraph.graph.size} files, ${edges.length} edges`);
  }

  // Warm path must restore the same symbol registry build() creates on the
  // cold path. Doing it here — inside the load mechanism — keeps every
  // loader entry point warm/cold isomorphic instead of patching one facade.
  depGraph.builder._buildSymbolRegistry();

  // O6: loaded graph is structurally complete — mark ready
  depGraph._finishBuilding();

  // A-2: precomputed restoration moved to orchestrator.js
  restorePrecomputed(depGraph);

  return true;
}

module.exports = { loadGraph };
