/**
 * WorkspaceSnapshot — read-only project view with self-awareness.
 *
 * Assembled by ServiceContainer after initialization. Provides:
 * 1. A stable, unified data interface for L4 tools and formatters.
 * 2. Self-awareness metadata (knownBlindSpots, confidenceByDomain) so AI
 *    consumers understand the boundaries of the data, not just the data.
 */

/**
 * Lightweight read-only view over a DependencyGraph.
 * Delegates all queries to the underlying graph without exposing
 * mutable lifecycle methods (build/updateFiles/analyzeFile).
 *
 * Runtime immutability is by convention — we do not deep-freeze
 * the internal Map because the graph may be incrementally updated
 * by file watchers during long-lived REPL sessions.
 */
class DependencyGraphView {
  constructor(depGraph) {
    this._dg = depGraph;
  }

  // --- properties ---
  get root() { return this._dg.root; }
  get graph() { return this._dg.graph; }
  get reverseGraph() { return this._dg.reverseGraph; }
  get entryFiles() { return this._dg.entryFiles; }
  get projectContext() { return this._dg.projectContext; }
  get packageJson() { return this._dg.packageJson; }
  get excludeDirs() { return this._dg.excludeDirs; }
  get cliExcludeDirs() { return this._dg.cliExcludeDirs; }

  // --- read accessors ---
  hasFile(filePath) { return this._dg.hasFile(filePath); }
  getFileInfo(filePath) { return this._dg.getFileInfo(filePath); }
  getAllFileInfos() { return this._dg.getAllFileInfos(); }
  getFileCount() { return this._dg.getFileCount(); }
  getAllFilePaths() { return this._dg.getAllFilePaths(); }
  getAllFileValues() { return this._dg.getAllFileValues(); }
  normalizeFilePath(filePath) { return this._dg.normalizeFilePath(filePath); }
  _displayPath(filePath) { return this._dg._displayPath(filePath); }
  shouldExclude(filePath) { return this._dg.shouldExclude(filePath); }
  shouldExcludeCli(filePath) { return this._dg.shouldExcludeCli(filePath); }
  isKnownEntryFile(filePath, exports) { return this._dg.isKnownEntryFile(filePath, exports); }
  getFrameworkHint(filePath) { return this._dg.getFrameworkHint(filePath); }
  isTestLikeFile(filePath) { return this._dg.isTestLikeFile(filePath); }

  // --- symbol impact ---
  getSymbolImpact(filePath, maxDepth) { return this._dg.getSymbolImpact(filePath, maxDepth); }
  getChangedFunctionImpact(filePath, lineRanges, options) { return this._dg.getChangedFunctionImpact(filePath, lineRanges, options); }
  getFunctionReuseHints(filePath, changedFunctions, options) { return this._dg.getFunctionReuseHints(filePath, changedFunctions, options); }
  getFunctionLevelAffectedTests(filePath, changedFunctions, options) { return this._dg.getFunctionLevelAffectedTests(filePath, changedFunctions, options); }

  // --- delegated queries (builder / analyzer / query) ---
  getDependencies(...args) { return this._dg.getDependencies(...args); }
  getDependents(...args) { return this._dg.getDependents(...args); }
  getImpactRadius(...args) { return this._dg.getImpactRadius(...args); }
  findDeadExports(...args) { return this._dg.findDeadExports(...args); }
  findCircularDependencies(...args) { return this._dg.findCircularDependencies(...args); }
  findUnresolvedImports(...args) { return this._dg.findUnresolvedImports(...args); }
  findAffectedTests(...args) { return this._dg.findAffectedTests(...args); }
  getStats(...args) { return this._dg.getStats(...args); }
  getPageRank(...args) { return this._dg.getPageRank(...args); }
  getScopeSummary(...args) { return this._dg.getScopeSummary(...args); }
  buildWarnings(...args) { return this._dg.buildWarnings(...args); }
  _scanSymbolUsageInImporters(...args) { return this._dg._scanSymbolUsageInImporters(...args); }
}

/**
 * WorkspaceSnapshot — immutable-ish project state assembled at container init.
 *
 * @typedef {Object} FileMetadata
 * @property {string} path
 * @property {number} mtime
 * @property {number} size
 * @property {string} hash
 * @property {string[]} symbols
 * @property {number} lineCount
 *
 * @typedef {Object} GitStatusSnapshot
 * @property {string|null} head
 */
class WorkspaceSnapshot {
  constructor(data) {
    this.generatedAt = Date.now();

    this.workspaceRoot = data.workspaceRoot;
    this.graph = data.graph;
    this.gitStatus = data.gitStatus || { head: null };
    this.frameworkHints = data.frameworkHints || new Map();
    this.projectContext = data.projectContext || null;

    // L1 data-consistency: files can be sourced live from fileIndex (production)
    // or a static array (tests / backward compat). This eliminates the stale-
    // files bug in REPL watch mode where depGraph is incrementally updated but
    // snapshot.files remains frozen at init-time.
    this._fileIndex = data.fileIndex || null;
    this._staticFiles = data.files || null;

    // Self-awareness metadata
    this.basedOn = {
      fileIndexVersion: data.fileIndexVersion || null,
      cacheStaleness: data.cacheStaleness || null,
      gitHead: data.gitHead || null,
    };
    this.knownBlindSpots = data.knownBlindSpots || [];
    this.confidenceByDomain = data.confidenceByDomain || new Map();
  }

  /**
   * Live view of file metadata.
   * When a fileIndex reference is provided (production), reads from the
   * canonical source on every access so incremental updates are visible.
   * Falls back to the static array supplied at construction time (tests).
   */
  get files() {
    if (this._fileIndex?.cache?.fileMetadata) {
      const files = [];
      for (const [filePath, meta] of this._fileIndex.cache.fileMetadata.entries()) {
        files.push({ path: filePath, ...meta });
      }
      return files;
    }
    return this._staticFiles || [];
  }

  /**
   * Read confidence for a specific analysis domain.
   * @param {string} domain — e.g. 'dead-exports', 'cycles', 'impact', 'security'
   * @returns {{level: string, reason: string}}
   */
  getConfidence(domain) {
    if (this.confidenceByDomain.has(domain)) {
      return this.confidenceByDomain.get(domain);
    }
    return { level: 'medium', reason: 'default confidence — no domain-specific calibration performed' };
  }

  /**
   * Human-readable summary of the snapshot's self-awareness.
   * Useful for `--format ai` and debug output.
   */
  getSelfAwarenessSummary() {
    return {
      generatedAt: this.generatedAt,
      basedOn: this.basedOn,
      knownBlindSpots: this.knownBlindSpots,
      confidenceByDomain: Object.fromEntries(this.confidenceByDomain),
    };
  }
}

// ============================================================================
// Self-awareness computation
// ============================================================================

const BASE_BLIND_SPOTS = [
  'static analysis does not cover runtime binding (dynamic require, eval, string-based module resolution)',
  'framework DI containers may hide true dependencies from import-graph analysis',
];

/**
 * Compute known blind spots based on project characteristics.
 * @param {import('../utils/project-context').ProjectContext|null} projectContext
 * @param {import('../services/dep-graph').DependencyGraph} depGraph
 * @returns {string[]}
 */
function computeKnownBlindSpots(projectContext, depGraph) {
  const blindSpots = BASE_BLIND_SPOTS.slice();
  const stats = depGraph.getStats();

  if (stats.files > 1) {
    const edgeRatio = stats.totalImports / stats.files;
    if (edgeRatio < 0.1) {
      blindSpots.push(
        'sparse import graph suggests constant-warehouse or scaffold pattern; dead-export detection is unreliable'
      );
    }
  }

  // Light-weight framework detection: Java/Kotlin projects have high Spring DI false-positive rate
  let hasJavaFamily = false;
  for (const filePath of depGraph.getAllFilePaths()) {
    const ext = filePath.slice(filePath.lastIndexOf('.'));
    if (ext === '.java' || ext === '.kt') {
      hasJavaFamily = true;
      break;
    }
  }
  if (hasJavaFamily) {
    blindSpots.push(
      'Java/Kotlin projects may use framework-managed entry points, static imports, or reflection invisible to static analysis'
    );
  }

  return blindSpots;
}

/**
 * Compute per-domain confidence levels.
 * @param {import('../utils/project-context').ProjectContext|null} projectContext
 * @param {import('../services/dep-graph').DependencyGraph} depGraph
 * @returns {Map<string, {level: string, reason: string}>}
 */
function computeConfidenceByDomain(projectContext, depGraph) {
  const map = new Map();
  const stats = depGraph.getStats();
  const edgeRatio = stats.files > 0 ? stats.totalImports / stats.files : 0;
  const isSparseGraph = stats.files > 1 && edgeRatio < 0.1;

  // Light-weight framework detection
  let hasJavaFamily = false;
  for (const filePath of depGraph.getAllFilePaths()) {
    const ext = filePath.slice(filePath.lastIndexOf('.'));
    if (ext === '.java' || ext === '.kt') {
      hasJavaFamily = true;
      break;
    }
  }

  // dead-exports
  if (isSparseGraph || hasJavaFamily) {
    map.set('dead-exports', {
      level: 'low',
      reason: isSparseGraph
        ? 'sparse import graph suggests constant-warehouse or scaffold pattern'
        : 'Java/Kotlin projects may use framework DI, static imports, or reflection invisible to static analysis',
    });
  } else {
    map.set('dead-exports', {
      level: 'high',
      reason: 'standard module graph with visible entry points',
    });
  }

  // cycles
  map.set('cycles', {
    level: 'high',
    reason: 'DFS-based cycle detection with framework-legitimate pattern filtering',
  });

  // impact
  map.set('impact', {
    level: 'high',
    reason: 'static import resolution covers all explicit dependencies',
  });

  // security
  map.set('security', {
    level: 'low',
    reason: 'regex-based pattern matching only; no AST semantic analysis for taint tracking',
  });

  return map;
}

module.exports = {
  DependencyGraphView,
  WorkspaceSnapshot,
  computeKnownBlindSpots,
  computeConfidenceByDomain,
};
