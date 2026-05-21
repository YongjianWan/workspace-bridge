/**
 * DependencyGraph - Import relationship analysis
 * Builds graph of import dependencies, computes impact radius
 *
 * NOTE: This file is now a facade. Core implementations moved to:
 *   - builder.js  : GraphBuilder
 *   - analyzer.js : GraphAnalyzer
 *   - query.js    : GraphQuery
 */
const fs = require('fs');
const path = require('path');
const { normalizePathKey, matchesPathFragment, normalizeFilePath: _normalizeFilePath } = require('../utils/path');
const { shouldExcludeCli: _shouldExcludeCli } = require('../utils/exclude-patterns');
const { ENTRY_BASE_NAMES } = require('../utils/project-context');
const { isTestLikeFile } = require('../utils/test-detector');
const {
  getSymbolImpact,
  getChangedFunctionImpact,
  getFunctionReuseHints,
  getFunctionLevelAffectedTests,
} = require('./dep-graph/symbol-impact');
const { detectFrameworkFromPath, detectFrameworkFromContent } = require('./dep-graph/framework-patterns');
const { DEFAULTS, LIMITS, CACHE_VERSION } = require('../config/constants');
const { GraphBuilder } = require('./dep-graph/builder');
const { GraphAnalyzer } = require('./dep-graph/analyzer');
const { GraphQuery } = require('./dep-graph/query');
const {
  FRAMEWORK_MANAGED_PATTERNS,
  KNOWN_CONFIG_NAMES,
  PYTHON_MAIN_PATTERN,
} = require('./dep-graph/shared');
class DependencyGraph {
  constructor(workspaceRoot, cache, options = {}) {
    this.root = workspaceRoot;
    this.cache = cache;
    this.graph = new Map(); // file -> {imports: [], exports: []}
    this.reverseGraph = new Map(); // file -> [files that import it]
    this.packageJson = this._readPackageJson();
    this.entryFiles = this._collectEntryFiles();
    this.excludeDirs = options.excludeDirs || [];
    this.cliExcludeDirs = options.cliExcludeDirs || [];
    this.projectContext = options.projectContext || null;
    this.quiet = options.quiet || false;
    // Content cache for _scanSymbolUsageInImporters: avoids re-reading the same
    // importer file hundreds of times during a single findDeadExports() call.
    this._scanContentCache = new Map();
    // Pattern cache for _scanSymbolUsageInImporters: RegExp objects are reused
    // across calls within a single build() lifecycle.
    this._scanPatternCache = new Map();
    this.builder = new GraphBuilder(this);
    this.analyzer = new GraphAnalyzer(this);
    this.query = new GraphQuery(this);
    // P85: cache the full filtered cycles array so getStats() and
    // findCircularDependencies() always return the same data.
    this._cachedCycles = null;
  }

  shouldExclude(filePath) {
    const base = path.basename(filePath);
    if (base === 'cache.db') return true;

    const normalized = normalizePathKey(filePath);
    return this.excludeDirs.some((dir) => matchesPathFragment(normalized, dir));
  }

  /**
   * Check whether a file was excluded by the CLI --exclude flag.
   * These files are kept in the dependency graph (so their imports still
   * protect production code from dead-export false positives) but filtered
   * out of report output.
   */
  shouldExcludeCli(filePath) {
    return _shouldExcludeCli(filePath, this.cliExcludeDirs);
  }

  normalizeFilePath(filePath) {
    return _normalizeFilePath(filePath, this.root);
  }

  _displayPath(filePath) {
    const info = this.graph.get(filePath);
    return info?.originalPath || filePath;
  }

  hasFile(filePath) {
    return this.graph.has(this.normalizeFilePath(filePath));
  }

  getFileInfo(filePath) {
    return this.graph.get(this.normalizeFilePath(filePath));
  }

  getAllFileInfos() {
    return Array.from(this.graph.entries());
  }

  _readPackageJson() {
    const packageJsonPath = path.join(this.root, 'package.json');
    if (!fs.existsSync(packageJsonPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    } catch {
      return null;
    }
  }

  _collectEntryFiles() {
    const entries = new Set();
    const packageJson = this.packageJson;
    if (!packageJson) return entries;

    const addEntry = (value) => {
      if (typeof value !== 'string' || !value.trim()) return;
      const resolved = normalizePathKey(path.resolve(this.root, value));
      entries.add(resolved);
    };

    addEntry(packageJson.main);
    if (packageJson.bin && typeof packageJson.bin === 'object') {
      for (const value of Object.values(packageJson.bin)) {
        addEntry(value);
      }
    } else {
      addEntry(packageJson.bin);
    }

    return entries;
  }

  isTestLikeFile(filePath) {
    return isTestLikeFile(filePath);
  }

  isKnownEntryFile(filePath, exports) {
    if (this.entryFiles.has(filePath)) return true;

    const normalized = normalizePathKey(filePath);
    const base = path.basename(normalized);
    if (FRAMEWORK_MANAGED_PATTERNS.some((pattern) => pattern.test(normalized))) {
      return true;
    }
    if (KNOWN_CONFIG_NAMES.has(base)) {
      return true;
    }
    if (ENTRY_BASE_NAMES.has(base)) {
      return true;
    }

    // Framework-aware entry detection (GitNexus pattern port)
    const pathHint = detectFrameworkFromPath(filePath);
    if (pathHint && pathHint.isEntry) {
      return true;
    }

    // Content-based framework detection + shebang / python main
    try {
      const stats = fs.statSync(filePath);
      if (stats.size > LIMITS.ENTRY_FILE_MAX_BYTES) return false;
      const fd = fs.openSync(filePath, 'r');
      let content = '';
      try {
        const buffer = Buffer.alloc(LIMITS.ENTRY_SCAN_BYTES);
        const bytesRead = fs.readSync(fd, buffer, 0, LIMITS.ENTRY_SCAN_BYTES, 0);
        content = buffer.toString('utf8', 0, bytesRead);
      } finally {
        fs.closeSync(fd);
      }

      const contentHint = detectFrameworkFromContent(filePath, content);
      if (contentHint && contentHint.isEntry) {
        return true;
      }

      if (content.startsWith('#!')) return true;
      if (PYTHON_MAIN_PATTERN.test(content)) return true;
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }

    return false;
  }

  /**
   * Get framework hint for a file (path-based detection + lightweight content fallback).
   * @param {string} filePath
   * @returns {{ framework: string, reason: string, isEntry: boolean } | null}
   */
  getFrameworkHint(filePath) {
    const pathHint = detectFrameworkFromPath(filePath);
    if (pathHint) return pathHint;

    // Fallback: scan first 800 bytes for framework signatures (decorators, imports, etc.)
    try {
      const stats = fs.statSync(filePath);
      if (stats.size > LIMITS.ENTRY_FILE_MAX_BYTES) return null;
      const fd = fs.openSync(filePath, 'r');
      try {
        const buffer = Buffer.alloc(LIMITS.ENTRY_SCAN_BYTES);
        const bytesRead = fs.readSync(fd, buffer, 0, LIMITS.ENTRY_SCAN_BYTES, 0);
        const content = buffer.toString('utf8', 0, bytesRead);
        return detectFrameworkFromContent(filePath, content);
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return null;
    }
  }

  getSymbolImpact(filePath, maxDepth = 4) {
    return getSymbolImpact(this, filePath, maxDepth);
  }

  getChangedFunctionImpact(filePath, lineRanges, options = {}) {
    return getChangedFunctionImpact(this, filePath, lineRanges, options);
  }

  getFunctionReuseHints(filePath, changedFunctions, options = {}) {
    return getFunctionReuseHints(this, filePath, changedFunctions, options);
  }

  getFunctionLevelAffectedTests(filePath, changedFunctions, options = {}) {
    return getFunctionLevelAffectedTests(this, filePath, changedFunctions, options);
  }

  async build(...args) {
    return this.builder.build(...args);
  }

  async updateFiles(...args) {
    return this.builder.updateFiles(...args);
  }

  async analyzeFile(...args) {
    return this.builder.analyzeFile(...args);
  }

  buildReverseGraph(...args) {
    return this.builder.buildReverseGraph(...args);
  }

  /**
   * D3: Load graph + reverseGraph from persisted edges in SQLite.
   * Skips buildReverseGraph() and post-process if edges are fresh.
   * Returns true on success, false to fall back to build().
   */
  loadGraph() {
    // Staleness guard: if files changed on disk since last edge save,
    // fall back to full build() to ensure consistency.
    try {
      const changeCheck = this.cache.checkFileChanges();
      if (changeCheck.changed) {
        if (!this.quiet) {
          console.error(`[DepGraph] Files changed on disk (${changeCheck.changedFiles.length} files), skipping loadGraph`);
        }
        return false;
      }
    } catch {
      return false;
    }

    const edges = this.cache.loadEdges();
    if (!edges || edges.length === 0) {
      return false;
    }

    // Validate persisted edge metadata for coarse staleness detection
    const edgeMeta = this.cache.edgeMeta;
    if (edgeMeta) {
      if (edgeMeta.cacheVersion !== CACHE_VERSION) return false;
      if (edgeMeta.fileMetadataCount !== this.cache.fileMetadata.size) return false;
      if (edgeMeta.parseResultsCount !== this.cache.parseResults.size) return false;
    }

    this.graph.clear();
    this.reverseGraph.clear();
    this._cachedCycles = null;
    this._cycleCount = undefined;
    if (this.analyzer) {
      this.analyzer._bumpAggregateCache();
    }

    // Rebuild edge map and reverseGraph from persisted edges
    const edgeMap = new Map();
    for (const edge of edges) {
      if (!edgeMap.has(edge.source)) {
        edgeMap.set(edge.source, []);
      }
      edgeMap.get(edge.source).push(edge.target);

      if (!this.reverseGraph.has(edge.target)) {
        this.reverseGraph.set(edge.target, []);
      }
      const dependents = this.reverseGraph.get(edge.target);
      if (!dependents.includes(edge.source)) {
        dependents.push(edge.source);
      }
    }

    // Restore graph nodes from parseResults, using edges for imports
    for (const [filePath, result] of this.cache.parseResults) {
      const meta = this.cache.getFileMetadata(filePath);
      this.graph.set(filePath, {
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
      });
    }

    // Handle orphan edges (files in edges but missing from parseResults)
    for (const [source, targets] of edgeMap) {
      if (!this.graph.has(source)) {
        this.graph.set(source, {
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

    if (!this.quiet) {
      console.error(`[DepGraph] Loaded graph from edges: ${this.graph.size} files, ${edges.length} edges`);
    }

    // D7-D8: attempt to load precomputed aggregates + impact from SQLite
    try {
      const aggregateRows = this.cache.loadPrecomputedAggregates();
      if (aggregateRows && aggregateRows.length > 0) {
        const ok = this.analyzer.injectPrecomputedAggregates(aggregateRows, this.graph.size);
        if (!this.quiet && ok) {
          console.error('[DepGraph] Precomputed aggregates restored from cache');
        }
      }

      const impactRows = this.cache.loadPrecomputedImpact();
      if (impactRows && impactRows.length > 0) {
        const ok = this.analyzer.injectPrecomputedImpact(impactRows, this.graph.size);
        if (!this.quiet && ok) {
          console.error('[DepGraph] Precomputed impact restored for', impactRows.length, 'files');
        }
      }
    } catch (e) {
      if (process.env.DEBUG) {
        console.error('[DepGraph] Precomputed load failed:', e.message);
      }
    }

    return true;
  }

  getDependencies(...args) {
    return this.query.getDependencies(...args);
  }

  getDependents(...args) {
    return this.query.getDependents(...args);
  }

  getImpactRadius(...args) {
    return this.query.getImpactRadius(...args);
  }

  getImpactStats(...args) {
    return this.analyzer.getImpactStats(...args);
  }

  get symbolRegistry() {
    return this.builder.symbolRegistry;
  }

  findDeadExports(...args) {
    return this.analyzer.findDeadExports(...args);
  }

  findCircularDependencies(...args) {
    return this.analyzer.findCircularDependencies(...args);
  }

  findUnresolvedImports(...args) {
    return this.analyzer.findUnresolvedImports(...args);
  }

  findAffectedTests(...args) {
    return this.analyzer.findAffectedTests(...args);
  }

  getStats(...args) {
    return this.analyzer.getStats(...args);
  }

  getPageRank(...args) {
    return this.analyzer.getPageRank(...args);
  }

  getScopeSummary(...args) {
    return this.analyzer.getScopeSummary(...args);
  }

  buildWarnings(...args) {
    return this.analyzer.buildWarnings(...args);
  }

  _scanSymbolUsageInImporters(...args) {
    return this.analyzer._scanSymbolUsageInImporters(...args);
  }

}
module.exports = {
  DependencyGraph,
  GraphBuilder,
  GraphAnalyzer,
};