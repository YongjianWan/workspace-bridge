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
const { normalizePathKey, matchesPathFragment, normalizeFilePath } = require('../utils/path');
const { shouldExcludeBase, shouldExcludeCli: _shouldExcludeCli } = require('../utils/exclude-patterns');
const { ENTRY_BASE_NAMES } = require('../utils/project-context');
const { isTestLikeFile } = require('../utils/test-detector');
const {
  getSymbolImpact,
  getChangedFunctionImpact,
  getFunctionReuseHints,
  getFunctionLevelAffectedTests,
} = require('./dep-graph/symbol-impact');
const { DEFAULTS, LIMITS, CACHE_VERSION } = require('../config/constants');
const { EventBus } = require('../utils/event-bus');
const { GraphBuilder } = require('./dep-graph/builder');
const { GraphAnalyzer } = require('./dep-graph/analyzer');
const { GraphQuery } = require('./dep-graph/query');
const { EntryDetector } = require('./dep-graph/entry-detector');
const { loadGraph: loadGraphImpl } = require('./dep-graph/loader');
const { DG_STATES, GraphStateMachine } = require('./dep-graph/state-machine');
const { registerGraphBuiltHandler } = require('./dep-graph/persistence');
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
    // A-2: core logic extracted to orchestrator.js; thin wrapper kept for
    // backward compatibility with ~20+ tests that call it directly.
    // Pass DependencyGraphClass explicitly to avoid circular dependency.
    return require('./orchestrator').bootstrapFromSchema(workspaceRoot, schema, {
      ...options,
      DependencyGraphClass: DependencyGraph,
    });
  }

  constructor(workspaceRoot, cache, options = {}) {
    this.root = workspaceRoot;
    this.normalizeFilePath = (filePath) => normalizeFilePath(filePath, workspaceRoot);
    this.cache = cache;
    this.graph = new Map(); // file -> {imports: [], exports: []}
    this.reverseGraph = new Map(); // file -> [files that import it]
    this.packageJson = options.packageJson !== undefined ? options.packageJson : this._readPackageJson();
    this.entryFiles = options.entryFiles !== undefined ? options.entryFiles : this._collectEntryFiles();
    this.excludeDirs = options.excludeDirs || [];
    this.cliExcludeDirs = options.cliExcludeDirs || [];
    this.projectContext = options.projectContext || null;
    this.quiet = options.quiet || false;
    this._stateMachine = new GraphStateMachine();
    this.bus = new EventBus();
    this.entryDetector = new EntryDetector({
      entryFiles: this.entryFiles,
      normalizeFilePath: this.normalizeFilePath,
      bus: this.bus,
    });
    this.builder = new GraphBuilder(this);
    this.analyzer = new GraphAnalyzer(this);
    this.query = new GraphQuery(this);
    // A-2: post-build orchestration (precompute + persistence) moved to
    // orchestrator.js so the facade doesn't carry cross-module coordination.
    registerGraphBuiltHandler(this);

    // O6: backward-compatible _updating getter — state managed by _transition()
    Object.defineProperty(this, '_updating', {
      get: () => this._stateMachine.state === DG_STATES.UPDATING,
      set: () => { /* no-op for backward compat */ },
      enumerable: false,
      configurable: true,
    });
  }

  shouldExclude(filePath) {
    return shouldExcludeBase(filePath, this.excludeDirs);
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

  get state() {
    return this._stateMachine.state;
  }

  // A-2: state machine logic extracted to orchestrator.js GraphStateMachine.
  // These thin wrappers preserve backward compatibility for builder.js and tests.
  _transition(toState) { this._stateMachine._transition(toState); }
  _startBuilding() { this._stateMachine._startBuilding(); }
  _finishBuilding() { this._stateMachine._finishBuilding(); }
  _startUpdating() { this._stateMachine._startUpdating(); }
  _finishUpdating() { this._stateMachine._finishUpdating(); }
  _markError() { this._stateMachine._markError(); }
  _resetState() { this._stateMachine._resetState(); }

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
    return this.entryDetector.isKnownEntryFile(filePath, exports);
  }

  getFrameworkHint(filePath) {
    return this.entryDetector.getFrameworkHint(filePath);
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
  loadGraph(options = {}) {
    return loadGraphImpl(this, options);
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

  findAffectedRoutes(...args) {
    return this.analyzer.findAffectedRoutes(...args);
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
  DG_STATES,
};