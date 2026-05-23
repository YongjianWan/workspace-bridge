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
const { EventBus } = require('../utils/event-bus');
const { GraphBuilder } = require('./dep-graph/builder');
const { GraphAnalyzer } = require('./dep-graph/analyzer');
const { GraphQuery } = require('./dep-graph/query');
const {
  FRAMEWORK_MANAGED_PATTERNS,
  KNOWN_CONFIG_NAMES,
  PYTHON_MAIN_PATTERN,
} = require('./dep-graph/shared');
class DependencyGraph {
  /**
   * Fast static factory to build a pre-populated DependencyGraph instance from a schema.
   * Eliminates direct file-system scanning in tests and mock scenarios.
   * @param {string} workspaceRoot
   * @param {Record<string, object>} schema
   * @param {object} [options]
   * @returns {DependencyGraph}
   */
  static fromSchema(workspaceRoot, schema, options = {}) {
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

    // Build node map from schema
    for (const [file, node] of Object.entries(schema || {})) {
      const imports = node.imports || [];
      depGraph.graph.set(file, {
        originalPath: node.originalPath || file,
        imports: imports,
        exports: node.exports || [],
        importRecords: node.importRecords || [],
        exportRecords: node.exportRecords || [],
        functionRecords: node.functionRecords || [],
        parseMode: node.parseMode || 'ast',
        confidence: node.confidence || 'medium',
        package: node.package || null,
      });
    }

    // Auto-build reverseGraph using production builder method to align contracts 100%!
    depGraph.buildReverseGraph();

    if (options.projectContext) {
      depGraph.projectContext = options.projectContext;
    }

    return depGraph;
  }

  constructor(workspaceRoot, cache, options = {}) {
    this.root = workspaceRoot;
    this.cache = cache;
    this.graph = new Map(); // file -> {imports: [], exports: []}
    this.reverseGraph = new Map(); // file -> [files that import it]
    this.packageJson = options.packageJson !== undefined ? options.packageJson : this._readPackageJson();
    this.entryFiles = options.entryFiles !== undefined ? options.entryFiles : this._collectEntryFiles();
    this.excludeDirs = options.excludeDirs || [];
    this.cliExcludeDirs = options.cliExcludeDirs || [];
    this.projectContext = options.projectContext || null;
    this.quiet = options.quiet || false;
    this.bus = new EventBus();
    // O4: Builder no longer knows Analyzer. The facade listens to 'graph:built'
    // and coordinates post-build precompute + persistence so Builder stays a
    // pure graph-construction engine.
    this.bus.on('graph:built', async () => {
      this.analyzer.precomputeAggregates();
      this.analyzer.precomputeImpact();
      await this._savePrecomputed();
    });
    this.builder = new GraphBuilder(this);
    this.analyzer = new GraphAnalyzer(this);
    this.query = new GraphQuery(this);
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

  getFileCount() {
    return this.graph.size;
  }

  getAllFilePaths() {
    return Array.from(this.graph.keys());
  }

  getAllFileValues() {
    return Array.from(this.graph.values());
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
    this.bus.emit('graph:updated');

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

  /**
   * D7-D8: Serialize and save precomputed aggregates + impact to SQLite.
   * Moved from builder.js to dep-graph.js (facade) as part of O4 decoupling:
   * Builder no longer knows Analyzer; the facade coordinates persistence.
   */
  async _savePrecomputed() {
    if (!this.cache) return;
    try {
      const analyzer = this.analyzer;
      const graphSize = this.graph.size;

      // Save aggregates
      const aggregateRows = [];
      if (analyzer._aggregateCache) {
        const cache = analyzer._aggregateCache;
        if (cache.deadExports !== undefined) {
          aggregateRows.push({
            key: 'deadExports',
            data: JSON.stringify(cache.deadExports),
            version: analyzer._aggregateVersion,
            fileCount: graphSize,
          });
        }
        if (cache.unresolved !== undefined) {
          aggregateRows.push({
            key: 'unresolved',
            data: JSON.stringify(cache.unresolved),
            version: analyzer._aggregateVersion,
            fileCount: graphSize,
          });
        }
        if (cache.cycles !== undefined) {
          aggregateRows.push({
            key: 'cycles',
            data: JSON.stringify(cache.cycles),
            version: analyzer._aggregateVersion,
            fileCount: graphSize,
          });
        }
        if (cache.stats !== undefined) {
          aggregateRows.push({
            key: 'stats',
            data: JSON.stringify(cache.stats),
            version: analyzer._aggregateVersion,
            fileCount: graphSize,
          });
        }
      }
      if (aggregateRows.length > 0) {
        this.cache.savePrecomputedAggregates(aggregateRows);
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
        this.cache.savePrecomputedImpact(impactRecords);
      }
    } catch (e) {
      if (process.env.DEBUG) {
        console.error('[DependencyGraph] _savePrecomputed failed:', e.message);
      }
    }
  }

  // Backwards compatibility getters/setters for test assertions and tools
  get _scanContentCache() {
    return this.analyzer ? this.analyzer._scanContentCache : null;
  }
  set _scanContentCache(val) {
    if (this.analyzer) this.analyzer._scanContentCache = val;
  }

  get _scanPatternCache() {
    return this.analyzer ? this.analyzer._scanPatternCache : null;
  }
  set _scanPatternCache(val) {
    if (this.analyzer) this.analyzer._scanPatternCache = val;
  }

  get _cachedCycles() {
    return this.analyzer ? this.analyzer._cachedCycles : null;
  }
  set _cachedCycles(val) {
    if (this.analyzer) this.analyzer._cachedCycles = val;
  }

  get _cycleCount() {
    return this.analyzer ? this.analyzer._cycleCount : undefined;
  }
  set _cycleCount(val) {
    if (this.analyzer) this.analyzer._cycleCount = val;
  }

}
module.exports = {
  DependencyGraph,
  GraphBuilder,
  GraphAnalyzer,
};