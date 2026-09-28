/**
 * DependencyGraph - Import relationship analysis
 * Builds graph of import dependencies, computes impact radius
 *
 * NOTE: This file is now a facade. Core implementations moved to:
 *   - builder.js  : GraphBuilder
 *   - analyzer.js : GraphAnalyzer
 *   - query.js    : GraphQuery
 *
 * Architecture Phases:
 * 1. Parse Phase: GraphBuilder parses files (either incrementally or on a full cold build)
 *    to extract imports, exports, functions, and symbols, storing them in local databases.
 * 2. Link Phase: GraphBuilder / resolvers resolve raw import strings to actual file targets
 *    in the workspace, linking the nodes. GraphAnalyzer runs topological sorting, cycle detection,
 *    and dead export calculations across the fully resolved graph.
 */
const path = require('path');
const { normalizePathKey, normalizeFilePath, toRelativePosix } = require('../utils/path');
const { shouldExcludeBase, shouldExcludeCli: _shouldExcludeCli } = require('../utils/exclude-patterns');
const { isTestLikeFile } = require('../utils/test-detector');
const {
  getSymbolImpact,
  getChangedFunctionImpact,
  getFunctionReuseHints,
  getFunctionLevelAffectedTests,
} = require('./dep-graph/symbol-impact');
const { EventBus } = require('../utils/event-bus');
const { GraphBuilder } = require('./dep-graph/builder');
const { GraphAnalyzer } = require('./dep-graph/analyzer');
const { GraphQuery } = require('./dep-graph/query');
const { EntryDetector } = require('./dep-graph/entry-detector');
const { collectUnresolvedImports } = require('./dep-graph/unresolved-imports');
const { DG_STATES, GraphStateMachine } = require('./dep-graph/state-machine');
const { getRegisteredQueryFiles } = require('./dep-graph/framework-patterns');
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
      getFileInfo: (p) => this.getFileInfo(p),
    });
    this.builder = new GraphBuilder(this);
    this.analyzer = new GraphAnalyzer(this);
    this.query = new GraphQuery(this);
    // Aggregates (dead exports, cycles, unresolved, stats) are recomputed on
    // every build: a stale aggregate would make audit-overview disagree with
    // the atomic commands for the same graph.
    this.bus.on('graph:built', () => this.analyzer.precomputeAggregates());

    // O6: backward-compatible _updating getter — state managed by _transition()
    Object.defineProperty(this, '_updating', {
      get: () => this._stateMachine.state === DG_STATES.UPDATING,
      set: () => { /* no-op for backward compat */ },
      enumerable: false,
      configurable: true,
    });

    // Backward-compatible _state property — state managed by GraphStateMachine
    Object.defineProperty(this, '_state', {
      get: () => this._stateMachine.state,
      set: (val) => { this._stateMachine._transition(val); },
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
    if (_shouldExcludeCli(filePath, this.cliExcludeDirs)) return true;

    // Exclude files in non-active directory roles from CLI findings output.
    // Reference/archive/generated files stay in the graph to protect active
    // code from dead-export false positives, but are filtered from reports.
    if (this.projectContext && typeof this.projectContext.classifyFile === 'function') {
      const classification = this.projectContext.classifyFile(filePath);
      if (classification && !classification.isMainline) {
        return true;
      }
    }

    const ignoredFrameworks = this.projectContext?.config?.ignore?.frameworks;
    if (ignoredFrameworks?.length > 0) {
      const info = this.getFileInfo(filePath);
      if (info?.frameworkHint?.framework && ignoredFrameworks.includes(info.frameworkHint.framework)) {
        return true;
      }
    }
    return false;
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
    if (this.graph.has(filePath)) return true;
    return this.graph.has(this.normalizeFilePath(filePath));
  }

  getFileInfo(filePath) {
    const direct = this.graph.get(filePath);
    if (direct !== undefined) return direct;
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
    const { readJsonSafe } = require('../utils/path');
    return readJsonSafe(packageJsonPath);
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

  getCycleMeta(...args) {
    return this.analyzer.getCycleMeta(...args);
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

  findAffectedHttpRoutes(...args) {
    return this.query.findAffectedHttpRoutes(...args);
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

  /**
   * Unresolved imports visible from the current graph.
   * Bare Python names have uncertain ownership and are reported separately.
   */
  getDroppedImports() {
    const { local, uncertain } = collectUnresolvedImports(
      this.graph, this.root, this.builder?.workspacePackages,
    );
    const display = (samples) => samples.map((sample) => ({
      file: this._displayPath(sample.file),
      specifier: sample.specifier,
    }));
    return {
      count: local.count,
      files: local.files.size,
      samples: display(local.samples),
      uncertainCount: uncertain.count,
      uncertainFiles: uncertain.files.size,
      uncertainSamples: display(uncertain.samples),
      measured: true,
    };
  }

  findOrphanFiles(toRelativeFn = null) {
    const { findOrphanFiles: detectOrphans } = require('../utils/orphan-detector');
    const allFiles = this.getAllFilePaths();
    const registeredFiles = new Set();
    for (const registeredPath of getRegisteredQueryFiles()) {
      registeredFiles.add(this.normalizeFilePath(registeredPath));
    }
    // A C/C++ implementation file is reached through its paired header.
    for (const file of allFiles) {
      if (this.analyzer.hasPairedCHeader(file)) registeredFiles.add(file);
    }
    const orphans = detectOrphans(
      allFiles,
      this.entryFiles,
      this,
      this.root,
      toRelativeFn,
      this.isKnownEntryFile?.bind(this),
      this.shouldExcludeCli?.bind(this),
      registeredFiles
    );
    // Classification runs on graph keys (lower-cased on Windows) so directory
    // rules match regardless of casing; output goes back to on-disk casing.
    const toRel = toRelativeFn || toRelativePosix;
    const onDisk = new Map(allFiles.map((f) => [toRel(this.root, f), toRel(this.root, this._displayPath(f))]));
    const display = (rel) => onDisk.get(rel) ?? rel;
    return Object.fromEntries(Object.entries(orphans).map(([group, list]) => [group, list.map(display)]));
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
