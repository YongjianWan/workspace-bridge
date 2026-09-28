/**
 * GraphOrchestrator - Coordinates DependencyGraph construction so that
 * dep-graph.js stays a thin facade over graph data structures.
 */

const { DG_STATES, GraphStateMachine } = require('./dep-graph/state-machine');

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
      parseModeReason: node.parseModeReason || '',
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

  // FileIndex 本轮遍历的降级信号（depth-truncated 等）挂到图上，走
  // analyzer.buildWarnings() 的统一出口（_parseErrorFiles 同款形状）。
  if (fileIndex && Array.isArray(fileIndex.warnings)) {
    depGraph._indexWarnings = fileIndex.warnings;
  }

  // 发现阶段被丢弃的已知源码扩展文件（无 parser 认领）同上挂图——
  // analyzer 的 coverage 分母读它。
  if (fileIndex && Array.isArray(fileIndex.unsupportedSourceFiles)) {
    depGraph._unsupportedSourceFiles = fileIndex.unsupportedSourceFiles;
  }

  // The graph is rebuilt on every initialize. Unchanged files come from the
  // content-keyed parse cache; resolution and every graph-level result are
  // recomputed, so a warm run cannot differ from a cold one.
  await depGraph.build(fileIndex?._indexedFiles || null);

  return depGraph;
}

module.exports = {
  DG_STATES,
  GraphStateMachine,
  bootstrapFromSchema,
  initializeDepGraph,
};
