/**
 * GraphOrchestrator - Coordinates DependencyGraph lifecycle, event handling,
 * and precompute persistence so that dep-graph.js stays a thin facade over
 * graph data structures.
 *
 * Extracted from dep-graph.js as Route A-2 ("default host" debt reduction).
 */

const { DG_STATES, GraphStateMachine } = require('./dep-graph/state-machine');
const {
  registerGraphBuiltHandler,
  savePrecomputed,
  restorePrecomputed,
} = require('./dep-graph/persistence');

/**
 * Bootstrap a DependencyGraph from a serialized schema (tests, mocks).
 * Core logic extracted from DependencyGraph.fromSchema; the static method
 * on the class is kept as a thin backward-compatible wrapper.
 * @param {string} workspaceRoot
 * @param {Record<string, object>} schema
 * @param {object} [options]
 * @param {DependencyGraph} options.DependencyGraphClass — class reference to avoid circular dep
 * @returns {DependencyGraph}
 */
function bootstrapFromSchema(workspaceRoot, schema, options = {}) {
  const DependencyGraph = options.DependencyGraphClass;
  if (!DependencyGraph) {
    throw new Error('bootstrapFromSchema requires options.DependencyGraphClass to avoid circular dependency');
  }
  const depGraph = new DependencyGraph(
    workspaceRoot,
    options.cache !== undefined ? options.cache : null,
    {
      quiet: true,
      packageJson: options.packageJson || null,
      entryFiles: options.entryFiles || new Set(),
      ...options,
    }
  );

  // Normalize schema keys and paths the same way production code does.
  // On Windows, normalizeFilePath resolves relatives, uses POSIX slashes,
  // and lowercases the drive letter, so graph keys stay consistent.
  const keyMap = new Map();
  for (const [file] of Object.entries(schema || {})) {
    const normalizedKey = depGraph.normalizeFilePath(file);
    keyMap.set(file, normalizedKey);
    // Self-consistency: normalized values resolve to themselves.
    keyMap.set(normalizedKey, normalizedKey);
  }

  function resolvePath(p) {
    if (keyMap.has(p)) return keyMap.get(p);
    return depGraph.normalizeFilePath(p);
  }

  // Build node map from schema. If two schema keys normalize to the same
  // graph key (e.g. POSIX and Windows absolute paths on Windows), keep the
  // first occurrence so that originalPath/output format is deterministic.
  for (const [file, node] of Object.entries(schema || {})) {
    const key = keyMap.get(file);
    if (depGraph.graph.has(key)) continue;
    const imports = (node.imports || []).map(resolvePath).filter(Boolean);
    const importRecords = (node.importRecords || []).map((r) => ({
      ...r,
      resolved:
        typeof r.resolved === 'string' && r.resolved.length > 0
          ? resolvePath(r.resolved)
          : r.resolved,
    }));
    depGraph.graph.set(key, {
      originalPath: node.originalPath || file,
      imports,
      exports: node.exports || [],
      importRecords,
      exportRecords: node.exportRecords || [],
      functionRecords: node.functionRecords || [],
      parseMode: node.parseMode || 'ast',
      confidence: node.confidence || 'medium',
      package: node.package || null,
      frameworkHint: node.frameworkHint || null,
    });
  }

  // Auto-build reverseGraph using production builder method
  depGraph.buildReverseGraph();

  if (options.projectContext) {
    depGraph.projectContext = options.projectContext;
  }

  // O6: fromSchema produces a fully-formed graph — mark ready without build()
  depGraph._finishBuilding();

  return depGraph;
}

/**
 * Initialize a DependencyGraph for a ServiceContainer.
 * Encapsulates the load/build/update decision tree previously inline in
 * container.js _initDepGraph().
 * @param {object} deps
 * @param {DependencyGraph} deps.DependencyGraphClass
 * @param {string} deps.workspaceRoot
 * @param {object} deps.cache
 * @param {object} deps.fileIndex
 * @param {object} [deps.projectContext]
 * @param {boolean} [deps.quiet]
 * @param {object} [deps.options]
 * @returns {Promise<DependencyGraph>}
 */
async function initializeDepGraph({
  DependencyGraphClass,
  workspaceRoot,
  cache,
  fileIndex,
  projectContext,
  quiet,
  options = {},
}) {
  const depGraph = new DependencyGraphClass(workspaceRoot, cache, {
    excludeDirs: fileIndex?.baseExcludeDirs || [],
    cliExcludeDirs: fileIndex?.cliExcludeDirs || [],
    projectContext,
    quiet,
    ...options,
  });

  // D3: attempt fast-path load from persisted edges; fall back to full build()
  const loaded = depGraph.loadGraph({ skipChangeCheck: true });
  if (!loaded) {
    await depGraph.build(fileIndex?._indexedFiles || null);
  } else {
    // Hybrid path: edges loaded — compute delta and incrementally update
    const indexedFiles = new Set(fileIndex?._indexedFiles || []);
    const indexedKeys = new Set([...indexedFiles].map((f) => depGraph.normalizeFilePath(f)));
    const graphFiles = new Set(depGraph.getAllFilePaths());
    const filesToUpdate = [];

    // New files: in index but not in graph
    for (const f of indexedFiles) {
      const key = depGraph.normalizeFilePath(f);
      if (!graphFiles.has(key)) {
        if (depGraph.shouldExclude(f)) continue;
        if (depGraph.projectContext && !depGraph.projectContext.isActiveSourceFile(f)) {
          if (!depGraph.shouldExcludeCli(f)) continue;
        }
        filesToUpdate.push(f);
      }
    }

    // Deleted files: in graph but not in index and no metadata
    for (const f of graphFiles) {
      if (!indexedKeys.has(f) && !cache.hasFileMetadata(f)) {
        filesToUpdate.push(f);
      }
    }

    // Changed files: files that fileIndex re-indexed (mtime/size mismatch)
    const changedFiles = fileIndex?.changedFiles || [];
    for (const f of changedFiles) {
      filesToUpdate.push(f);
    }

    if (filesToUpdate.length > 0) {
      const uniqueFiles = [...new Set(filesToUpdate)];
      const graphSize = depGraph.getFileCount();
      // Fallback to full build if delta is too large (>50% of graph)
      if (graphSize > 0 && uniqueFiles.length > graphSize * 0.5) {
        if (!quiet) {
          // eslint-disable-next-line no-console
          console.error(`[Container] ${uniqueFiles.length} files delta (>50% of ${graphSize}), falling back to full build`);
        }
        // Reset state so the full build can transition from IDLE → BUILDING
        depGraph._resetState();
        await depGraph.build(fileIndex?._indexedFiles || null);
      } else {
        await depGraph.updateFiles(uniqueFiles);
      }
    } else {
      // Fully warm start — no files changed since last edge save
      depGraph.analyzer.precomputeAggregates();
    }
  }

  return depGraph;
}

module.exports = {
  DG_STATES,
  GraphStateMachine,
  registerGraphBuiltHandler,
  savePrecomputed,
  restorePrecomputed,
  bootstrapFromSchema,
  initializeDepGraph,
};
