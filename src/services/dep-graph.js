/**
 * DependencyGraph - Import relationship analysis
 * Builds graph of import dependencies, computes impact radius
 */
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { createImportRecord } = require('./dep-graph/parsers');
const { registry } = require('./dep-graph/parsers/registry');
const { resolveImport, clearResolverCaches } = require('./dep-graph/resolvers');
const { normalizePathKey, matchesPathFragment } = require('../utils/path');
const {
  getSymbolImpact,
  getChangedFunctionImpact,
  getFunctionReuseHints,
  getFunctionLevelAffectedTests,
} = require('./dep-graph/symbol-impact');
const { detectFrameworkFromPath, detectFrameworkFromContent } = require('./dep-graph/framework-patterns');
const {
  scanAndExtractImplicitImports,
  resolveImplicitImports,
  buildImplicitImportRecord,
} = require('./dep-graph/framework-usage-patterns');
const {
  normalizeHeuristicName,
  buildHeuristicSignature,
  getHeuristicLanguageFamily,
  isTestLikeFile,
} = require('../utils/test-detector');
const { ENTRY_BASE_NAMES } = require('../utils/project-context');
const { CACHE_FILENAME } = require('./cache');

const readFile = promisify(fs.readFile);

const { DEFAULTS, LIMITS } = require('../config/constants');

// 配置常量
const CONFIG = {
  DEFAULT_CONCURRENCY: 20,      // 默认并发数（内存安全考虑）
  DEFAULT_MAX_DEPTH: DEFAULTS.AFFECTED_TEST_DEPTH,
};

/**
 * Generic BFS traversal over a directed graph.
 * @param {string|string[]} startNodes - Starting node(s)
 * @param {Function} getNeighbors - (node) => string[]
 * @param {Object} options
 * @param {number} [options.maxDepth=Infinity]
 * @param {Function} [options.onVisit] - (node, depth, path) => any | undefined
 * @returns {any[]} collected results from onVisit
 */
function bfsTraverse(startNodes, getNeighbors, options = {}) {
  const visited = new Set();
  const queue = Array.isArray(startNodes)
    ? startNodes.map((n) => ({ node: n, depth: 0, path: [] }))
    : [{ node: startNodes, depth: 0, path: [] }];
  const maxDepth = Number.isFinite(options.maxDepth) ? options.maxDepth : Infinity;
  const results = [];

  while (queue.length > 0) {
    const { node, depth, path } = queue.shift();
    if (visited.has(node) || depth > maxDepth) continue;
    visited.add(node);

    if (options.onVisit) {
      const result = options.onVisit(node, depth, path);
      if (result !== undefined) results.push(result);
    }

    for (const neighbor of getNeighbors(node)) {
      if (!visited.has(neighbor)) {
        queue.push({
          node: neighbor,
          depth: depth + 1,
          path: depth === 0 ? [node] : [...path, node],
        });
      }
    }
  }

  return results;
}

/**
 * Compute confidence level and human-readable reason for dead-export findings.
 * P42/P56: eliminates the previous black-box where 90% of files were 'medium'.
 *
 * Rules:
 * - high: no importers + reliable graph → entire module is unused
 * - medium: importers exist + AST parse → AST precisely identified unused symbols
 * - low:  importers exist + regex parse → regex is coarse; or unreliable graph
 *
 * NOTE: importerCount does NOT downgrade AST findings. A file may have many
 * importers (because other exports are widely used) while a specific export is
 * genuinely unused. AST-level symbol tracking is the authoritative signal.
 */
function computeDeadExportConfidence(importerCount, parseMode, graphUnreliable) {
  if (importerCount === 0) {
    if (graphUnreliable) {
      return { confidence: 'low', reason: 'No importers, but dependency graph is sparse (possible parser miss)' };
    }
    return { confidence: 'high', reason: 'No files import this module; all exports are unused' };
  }

  if (parseMode === 'ast') {
    return { confidence: 'medium', reason: 'AST-level analysis found unused exports (dynamic imports or string calls may bypass static detection)' };
  }

  return { confidence: 'low', reason: 'Regex-based analysis; high false-positive risk' };
}

// #20: framework entry-file patterns promoted to module-level constant
const FRAMEWORK_MANAGED_PATTERNS = [
  /\/migrations\/.*\.py$/,
  /\/admin\.py$/,
  /\/apps\.py$/,
  /\/signals\.py$/,
  /\/tests\.py$/,
  /\/conftest\.py$/,
  /\/settings(\..+)?\.py$/,
  /\/urls\.py$/,
  /\/asgi\.py$/,
  /\/wsgi\.py$/,
  /\/manage\.py$/,
  /\/(page|layout|loading|error|not-found|route)\.(tsx|jsx|ts|js)$/,
  /\/(template|default)\.(tsx|jsx|ts|js)$/,
];

// #19: known config file names as a Set
const KNOWN_CONFIG_NAMES = new Set(['vite.config.js', 'vite.config.ts', 'vitest.config.ts', 'eslint.config.js']);

// #21: __main__ regex promoted to module-level constant
const PYTHON_MAIN_PATTERN = /if\s+__name__\s*==\s*['"]__main__['"]\s*:/;

// #16-#17: language dispatch now delegated to LanguageRegistry
// see src/services/dep-graph/parsers/registry.js for registration details

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
  }

  shouldExclude(filePath) {
    const base = path.basename(filePath);
    if (base === CACHE_FILENAME) return true;

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
    if (this.cliExcludeDirs.length === 0) return false;
    const normalized = normalizePathKey(filePath);
    return this.cliExcludeDirs.some((dir) => matchesPathFragment(normalized, dir));
  }

  normalizeFilePath(filePath) {
    return normalizePathKey(filePath);
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

  /**
   * Build dependency graph from all indexed files
   */
  async build() {
    const startTime = Date.now();

    // Refresh resolver FS caches for each build to avoid stale paths
    clearResolverCaches();

    // Reset graph to prevent ghost data from deleted/renamed files
    this.graph.clear();
    this._cycleCount = undefined;
    // Clear per-build caches to avoid stale content after rebuild
    this._scanContentCache.clear();
    this._scanPatternCache.clear();

    // Get all files from cache
    const candidateFiles = Array.from(this.cache.fileMetadata.keys()).filter((file) => {
      if (this.shouldExclude(file)) return false;
      if (this.projectContext && !this.projectContext.isActiveSourceFile(file)) {
        // L2-12: keep CLI-excluded files in the graph so their imports still
        // protect production code from false positives. They will be filtered
        // out of report output by shouldExcludeCli().
        if (!this.shouldExcludeCli(file)) return false;
      }
      return true;
    });
    const files = [];
    const seen = new Set();
    for (const file of candidateFiles) {
      const key = this.normalizeFilePath(file);
      if (seen.has(key)) continue;
      seen.add(key);
      files.push(file);
    }
    
    // Split: cache hit vs need analysis
    const cachedFiles = [];
    const filesToAnalyze = [];
    for (const file of files) {
      const meta = this.cache.getFileMetadata(file);
      const cached = this.cache.getParseResult(file);
      if (cached && meta && cached.mtime === meta.mtime) {
        const key = this.normalizeFilePath(file);
        this.graph.set(key, { ...cached });
        cachedFiles.push(file);
      } else {
        filesToAnalyze.push(file);
      }
    }
    
    // Process only changed/new files with concurrency limit
    await this._processFilesWithLimit(filesToAnalyze, CONFIG.DEFAULT_CONCURRENCY);

    // Build reverse graph
    this.buildReverseGraph();

    // Inject framework implicit dependencies (e.g. Vue router lazy-loading)
    this.applyFrameworkImplicitImports();

    const cacheHitRate = files.length > 0 ? Math.round((cachedFiles.length / files.length) * 100) : 0;
    if (!this.quiet) {
      console.error(`[DepGraph] Built in ${Date.now() - startTime}ms: ${this.graph.size} files (${cacheHitRate}% cached)`);
    }
    // Guard: if graph has files but zero edges, downstream analysis will produce false positives.
    const totalImports = Array.from(this.graph.values()).reduce((sum, i) => sum + i.imports.length, 0);
    if (this.graph.size > 0 && totalImports === 0) {
      console.error('[DepGraph] WARNING: Dependency graph appears empty (0 edges). Results may contain false positives.');
    }
  }

  /**
   * Process files with concurrency limit (reuse FileIndex pattern)
   */
  async _processFilesWithLimit(files, limit) {
    const executing = new Set();
    
    for (const file of files) {
      const promise = this.analyzeFile(file).then(() => {
        executing.delete(promise);
      });
      executing.add(promise);
      
      if (executing.size >= limit) {
        await Promise.race(executing);
      }
    }
    
    await Promise.all(executing);
  }

  /**
   * Analyze a single file for imports/exports
   */
  async analyzeFile(filePath) {
    try {
      const graphKey = this.normalizeFilePath(filePath);
      const content = await readFile(filePath, 'utf8');
      const ext = path.extname(filePath);
      
      let imports = [];
      let exports = [];
      let importRecords = [];
      let exportRecords = [];
      let functionRecords = [];
      let parseMode = 'none';

      const entry = registry.findByExt(ext);
      if (entry) {
        const args = entry.needsFilePath ? [content, filePath] : [content];
        const result = entry.async ? await entry.parser(...args) : entry.parser(...args);
        imports = result.imports;
        exports = result.exports;
        importRecords = result.importRecords || [];
        exportRecords = result.exportRecords || [];
        functionRecords = result.functionRecords || [];
        parseMode = result.parseMode || 'regex';
      }

      // Resolve relative imports to absolute paths
      const resolvedImportRecords = (importRecords.length > 0 ? importRecords : imports.map((source) => createImportRecord(source)))
        .map((record) => {
          const resolved = resolveImport(filePath, record.source, ext, this.root);
          if (!resolved) return null;
          return {
            ...record,
            resolved: this.normalizeFilePath(resolved),
          };
        })
        .filter(Boolean);
      const resolvedImports = resolvedImportRecords.map((record) => record.resolved).filter((imp) => imp !== graphKey);

      // L2-28: infer parseModeReason so consumers can tell why a file fell back to regex.
      let parseModeReason = 'unsupported-extension';
      if (entry) {
        if (parseMode === 'ast') {
          parseModeReason = 'ast-success';
        } else if (entry.async) {
          parseModeReason = 'regex-fallback';
        } else {
          parseModeReason = 'regex-native';
        }
      }

      this.graph.set(graphKey, {
        imports: resolvedImports,
        exports,
        importRecords: resolvedImportRecords,
        // python.js now returns proper exportRecords (B3 fixed); keep fallback for other parsers
        exportRecords,
        functionRecords: functionRecords.length > 0 ? functionRecords : [],
        parseMode,
        parseModeReason,
        confidence: parseMode === 'ast' ? 'high' : 'medium',
      });

      // Cache parse result for incremental rebuilds
      const meta = this.cache.getFileMetadata(filePath);
      if (meta) {
        this.cache.setParseResult(filePath, {
          ...this.graph.get(graphKey),
          mtime: meta.mtime,
        });
      }

    } catch (e) {
      // 单个文件分析失败不应阻塞整个依赖图构建，记录日志后继续
      console.error(`[DepGraph] Failed to analyze ${filePath}:`, e.message);
      // 删除 stale 记录，防止增量更新时 reverseGraph 与实际内容脱节
      this.graph.delete(this.normalizeFilePath(filePath));
      this.cache.deleteParseResult(filePath);
    }
  }

  _addReverseEdges(fileKey, imports, options = {}) {
    const { skipExisting = false } = options;
    const seen = new Set();
    for (const imp of imports) {
      if (seen.has(imp)) continue;
      seen.add(imp);
      if (!this.reverseGraph.has(imp)) {
        this.reverseGraph.set(imp, []);
      }
      const dependents = this.reverseGraph.get(imp);
      if (skipExisting && dependents.includes(fileKey)) continue;
      dependents.push(fileKey);
    }
  }

  _removeOldReverseEdges(fileKey) {
    const oldInfo = this.graph.get(fileKey);
    if (!oldInfo) return;
    for (const imp of oldInfo.imports) {
      const dependents = this.reverseGraph.get(imp);
      if (dependents) {
        const filtered = dependents.filter((d) => d !== fileKey);
        if (filtered.length > 0) {
          this.reverseGraph.set(imp, filtered);
        } else {
          this.reverseGraph.delete(imp);
        }
      }
    }
  }

  buildReverseGraph() {
    this.reverseGraph.clear();

    for (const [file, info] of this.graph) {
      this._addReverseEdges(file, info.imports);
    }
  }

  /**
   * Apply framework implicit imports after explicit graph is built.
   * Scans JS/TS/Vue files for framework patterns (Vue router lazy-loading,
   * global component registration) and injects resolved implicit edges into
   * both graph.imports/importRecords and reverseGraph.
   */
  applyFrameworkImplicitImports() {
    const startTime = Date.now();
    let implicitEdgeCount = 0;

    for (const [fileKey, info] of this.graph) {
      const ext = path.extname(fileKey).toLowerCase();
      if (!['.js', '.jsx', '.ts', '.tsx', '.vue', '.mjs', '.cjs'].includes(ext)) continue;

      let content;
      try {
        content = fs.readFileSync(fileKey, 'utf-8');
      } catch {
        continue;
      }

      const implicitSources = scanAndExtractImplicitImports(fileKey, content);
      if (implicitSources.length === 0) continue;

      const resolved = resolveImplicitImports(fileKey, implicitSources, this.root);
      if (resolved.length === 0) continue;

      // Defensive copy to avoid mutating cached arrays (cache-hit uses shallow clone)
      if (!info._implicitMutated) {
        info.imports = info.imports.slice();
        info.importRecords = info.importRecords.slice();
        info._implicitMutated = true;
        this.graph.set(fileKey, info);
      }

      for (const { source, resolved: resolvedPath, patternId } of resolved) {
        const normalizedResolved = this.normalizeFilePath(resolvedPath);
        if (normalizedResolved === fileKey) continue;

        if (!info.imports.includes(normalizedResolved)) {
          info.imports.push(normalizedResolved);
        }

        const hasRecord = info.importRecords.some(
          (r) => r.resolved === normalizedResolved && r.source === source
        );
        if (!hasRecord) {
          info.importRecords.push(
            buildImplicitImportRecord(source, normalizedResolved, patternId)
          );
        }

        if (!this.reverseGraph.has(normalizedResolved)) {
          this.reverseGraph.set(normalizedResolved, []);
        }
        const dependents = this.reverseGraph.get(normalizedResolved);
        if (!dependents.includes(fileKey)) {
          dependents.push(fileKey);
          implicitEdgeCount++;
        }
      }
    }

    if (!this.quiet && implicitEdgeCount > 0) {
      console.error(`[DepGraph] Applied ${implicitEdgeCount} framework implicit import edges in ${Date.now() - startTime}ms`);
    }
  }

  /**
   * Incrementally update dependency graph for changed files.
   * Removes old reverse edges, re-parses changed files, adds new reverse edges.
   * Does NOT rebuild the full reverse graph.
   */
  async updateFiles(filePaths) {
    if (this._updating) {
      // Reentrancy guard: debounce may trigger overlapping updates
      return;
    }
    this._updating = true;

    const startTime = Date.now();
    let reParsed = 0;
    let skipped = 0;

    try {
      for (const filePath of filePaths) {
      const key = this.normalizeFilePath(filePath);

      // Handle deleted files FIRST — must not be masked by cache-hit fast path
      if (!fs.existsSync(filePath)) {
        this._removeOldReverseEdges(key);
        this.graph.delete(key);
        this.cache.deleteFileMetadata(filePath);
        this.cache.deleteParseResult(filePath);
        this.cache.clearDiagnostics(filePath);
        this._scanContentCache.delete(key);
        continue;
      }

      // Fast path: file unchanged (graph and cache agree on mtime)
      const oldInfo = this.graph.get(key);
      const meta = this.cache.getFileMetadata(filePath);
      const cached = this.cache.getParseResult(filePath);
      if (oldInfo && cached && meta && cached.mtime === meta.mtime) {
        skipped++;
        continue;
      }

      this._removeOldReverseEdges(key);
      this._scanContentCache.delete(key);

      // Re-parse
      await this.analyzeFile(filePath);
      reParsed++;
      this._cycleCount = undefined;

      const newInfo = this.graph.get(key);
      if (newInfo) {
        this._addReverseEdges(key, newInfo.imports, { skipExisting: true });
      }
    }

    // Re-apply framework implicit imports when any file was re-parsed,
    // because re-parsing wipes previous implicit edges from graph.imports.
    if (reParsed > 0) {
      this.applyFrameworkImplicitImports();
    }

    if (!this.quiet && (reParsed > 0 || skipped > 0)) {
      console.error(`[DepGraph] Incremental update: ${reParsed} re-parsed, ${skipped} skipped in ${Date.now() - startTime}ms`);
    }
    } finally {
      this._updating = false;
    }
  }

  /**
   * Get direct dependencies of a file
   */
  getDependencies(filePath) {
    return this.getFileInfo(filePath)?.imports || [];
  }

  /**
   * Get files that depend on this file (reverse dependencies)
   */
  getDependents(filePath) {
    return this.reverseGraph.get(this.normalizeFilePath(filePath)) || [];
  }

  /**
   * Calculate impact radius: how many files would be affected by changing this file
   * P3: 增加 via（路径链）和 importedSymbols（导入符号），支撑变更影响解释
   */
  getImpactRadius(filePath, depth = 3) {
    const start = this.normalizeFilePath(filePath);
    return bfsTraverse(start, (file) => this.getDependents(file), {
      maxDepth: depth,
      onVisit: (file, level, via) => {
        if (level === 0 || file === start) return undefined;
        const currentInfo = this.getFileInfo(file);

        let importedSymbols = [];
        let importedSymbolsAvailable = false;
        if (currentInfo?.importRecords) {
          const parentFile = via[via.length - 1];
          const matchingImports = currentInfo.importRecords.filter((r) => r.resolved === parentFile);
          for (const record of matchingImports) {
            if (record.imported) importedSymbols.push(...record.imported);
          }
          importedSymbolsAvailable = matchingImports.length > 0 && matchingImports.some((r) => r.imported && r.imported.length > 0);
        }

        return {
          file,
          level,
          via: [...via],
          importedSymbols: [...new Set(importedSymbols)],
          importedSymbolsAvailable,
          reason: level === 1 ? 'direct-import' : 'transitive-dependency',
        };
      },
    });
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

  /**
   * Detect framework-legitimate cycles that are normal design patterns
   * rather than structural defects (e.g. Vue store -> router -> view).
   */
  isLikelyFrameworkLegitimateCycle(cycle) {
    if (cycle.length > 5) return false;

    const normalized = cycle.map((f) => f.replace(/\\/g, '/').toLowerCase());

    // All files must be in typical frontend source directories
    const allInFrontend = normalized.every(
      (f) =>
        /\/(src|pages|views|components|store|router|layout|layouts|assets|composables|hooks|mixins|directive|directives|plugins|utils|api|http)\//.test(f) ||
        /\.vue$/.test(f)
    );
    if (!allInFrontend) return false;

    // Must involve at least two of: store, router, vue/view
    const hasStore = normalized.some((f) => /\/store\//.test(f));
    const hasRouter = normalized.some((f) => /\/router\//.test(f));
    const hasView = normalized.some((f) => /\.vue$/.test(f) || /\/(views|pages|components|layout|layouts)\//.test(f));

    let dimensions = 0;
    if (hasStore) dimensions++;
    if (hasRouter) dimensions++;
    if (hasView) dimensions++;

    return dimensions >= 2;
  }

  /**
   * Find circular dependencies
   */
  findCircularDependencies() {
    const cycles = [];
    const visited = new Set();
    const stack = new Set();
    const MAX_CYCLE_DEPTH = DEFAULTS.AFFECTED_TEST_DEPTH + 2; // conservative guard

    const visit = (file, pathStack) => {
      if (pathStack.length > MAX_CYCLE_DEPTH) {
        // Depth guard: prevent stack overflow on extremely deep dependency chains
        return;
      }
      if (stack.has(file)) {
        // Found cycle
        const cycleStart = pathStack.indexOf(file);
        cycles.push(pathStack.slice(cycleStart));
        return;
      }

      if (visited.has(file)) return;

      visited.add(file);
      stack.add(file);
      pathStack.push(file);

      try {
        const deps = this.getDependencies(file);
        for (const dep of deps) {
          if (this.hasFile(dep)) {
            visit(dep, pathStack);
          }
        }
      } finally {
        pathStack.pop();
        stack.delete(file);
      }
    };

    for (const file of this.graph.keys()) {
      visit(file, []);
    }

    return cycles
      .filter((cycle) => !(cycle.length <= 2 && cycle[0] === cycle[cycle.length - 1]))
      .filter((cycle) => !this.isLikelyFrameworkLegitimateCycle(cycle));
  }

  getStats() {
    // Lazy-compute cycles to avoid O(V·E) DFS on every stats call
    if (this._cycleCount === undefined) {
      this._cycleCount = this.findCircularDependencies().length;
    }
    const cacheStats = this.cache?.getStats?.() || {};
    let parsedFiles = 0;
    let fallbackFiles = 0;
    for (const info of this.graph.values()) {
      if (info.parseMode === 'ast') parsedFiles++;
      else if (info.parseMode === 'regex') fallbackFiles++;
    }
    const totalFiles = this.graph.size;
    const coverageRatio = totalFiles > 0 ? parsedFiles / totalFiles : 0;
    return {
      files: totalFiles,
      totalImports: Array.from(this.graph.values()).reduce((sum, i) => sum + i.imports.length, 0),
      totalExports: Array.from(this.graph.values()).reduce((sum, i) => sum + i.exports.length, 0),
      cycles: this._cycleCount,
      totalLines: cacheStats.totalLines || 0,
      analysisCoverage: {
        totalFiles,
        parsedFiles,
        fallbackFiles,
        coverageRatio: Math.round(coverageRatio * 100) / 100,
      },
    };
  }

  /**
   * P1: 轻量扫描 importer 文件中的符号使用点
   * 通过简单 regex 查找方法调用/字段访问，补充 importRecords 未 capture 的使用
   * @param {string[]} importerPaths - importer 文件路径列表
   * @param {string[]} symbols - 待检查的符号名
   * @param {string} sourceFilePath - 被导入的源文件路径（用于判断语言）
   * @returns {Set<string>} 被使用的符号集合
   */
  _scanSymbolUsageInImporters(importerPaths, symbols, sourceFilePath) {
    const used = new Set();
    if (!symbols || symbols.length === 0) return used;

    const ext = path.extname(sourceFilePath).toLowerCase();
    const isJavaFamily = ext === '.java' || ext === '.kt';
    const patternCache = this._scanPatternCache;

    for (const importerPath of importerPaths) {
      try {
        let content = this._scanContentCache.get(importerPath);
        if (content === undefined) {
          content = fs.readFileSync(importerPath, 'utf-8');
          // Defensive cap: prevent unbounded growth in long-lived REPL sessions
          if (this._scanContentCache.size < LIMITS.SCAN_SYMBOL_CONTENT_CACHE_MAX) {
            this._scanContentCache.set(importerPath, content);
          }
        }

        for (const symbol of symbols) {
          if (used.has(symbol)) continue;
          const cacheKey = isJavaFamily ? `${symbol}:java` : symbol;
          let patterns = patternCache.get(cacheKey);
          if (!patterns) {
            const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            patterns = {
              callPattern: new RegExp(`\\b${escaped}\\s*\\(`),
              accessPattern: isJavaFamily ? new RegExp(`\\.${escaped}\\b`) : null,
            };
            patternCache.set(cacheKey, patterns);
          }
          if (patterns.callPattern.test(content) || (patterns.accessPattern && patterns.accessPattern.test(content))) {
            used.add(symbol);
          }
        }
        if (used.size === symbols.length) break;
      } catch {
        // ignore read errors
      }
    }

    return used;
  }

  /**
   * Phase 3: 查找未被引用的 exports（死代码）
   * @returns {Array<{file: string, exports: string[], confidence: 'high'|'medium'|'low'}>}
   * @description 无 importer 的文件 → high confidence。
   *   有 importer 的文件：先检查 importRecords，再轻量扫描 importer 内容中的使用点（P1），
   *   两者都未发现的符号才报告为 dead-export。
   */
  _collectUsedExports(importers, filePath) {
    let usesAllExports = false;
    const usedNames = new Set();

    for (const importerPath of importers) {
      const importerInfo = this.getFileInfo(importerPath);
      if (!importerInfo?.importRecords) {
        usesAllExports = true;
        break;
      }

      const matchingImports = importerInfo.importRecords.filter((record) => record.resolved === filePath);
      for (const record of matchingImports) {
        if (record.usesAllExports) {
          usesAllExports = true;
          break;
        }
        for (const importedName of record.imported || []) {
          usedNames.add(importedName);
        }
      }

      if (usesAllExports) break;
    }

    return { usedNames, usesAllExports };
  }

  findDeadExports() {
    const deadExports = [];

    for (const [filePath, info] of this.graph) {
      if (this.shouldExcludeCli(filePath)) continue;
      if (info.exports.length === 0) continue;
      if (this.isTestLikeFile(filePath)) continue;
      if (this.isKnownEntryFile(filePath, info.exports)) continue;
      const importers = this.getDependents(filePath);
      if (importers.length === 0) {
        // When the dependency graph has many files but suspiciously few edges,
        // the parser may be unavailable or the project uses an unsupported module
        // system. Downgrade confidence to avoid high-confidence false positives.
        const stats = this.getStats();
        const edgeRatio = stats.files > 0 ? stats.totalImports / stats.files : 0;
        const graphUnreliable = stats.files > 1 && edgeRatio < 0.1;
        const { confidence, reason } = computeDeadExportConfidence(0, info.parseMode, graphUnreliable);
        deadExports.push({ file: filePath, exports: info.exports, confidence, confidenceReason: reason, importerCount: 0 });
        continue;
      }

      const { usedNames, usesAllExports } = this._collectUsedExports(importers, filePath);
      if (usesAllExports) continue;

      let unused = info.exports.filter((name) => !usedNames.has(name));

      // P1: 轻量扫描 importer 文件中的实际使用点，消除 importRecords 未 capture 的误报
      if (unused.length > 0) {
        const scannedUsed = this._scanSymbolUsageInImporters(importers, unused, filePath);
        unused = unused.filter((name) => !scannedUsed.has(name));
      }

      if (unused.length > 0) {
        const { confidence, reason } = computeDeadExportConfidence(importers.length, info.parseMode, false);
        deadExports.push({ file: filePath, exports: unused, confidence, confidenceReason: reason, importerCount: importers.length });
      }
    }

    return deadExports;
  }

  /**
   * Phase 3: 查找解析失败的 imports
   * @returns {Array<{file: string, import: string, resolvedTo: string}>}
   * @description info.imports 已经是 analyzeFile 里 resolveImport() 处理过的绝对路径。
   *   这里只报告真实不存在的路径；静态资源（如 json/css）即使未被索引，也不应视为 unresolved。
   */
  findUnresolvedImports() {
    const unresolved = [];

    for (const [filePath, info] of this.graph) {
      if (this.shouldExcludeCli(filePath)) continue;
      for (const imp of info.imports) {
        if (!this.hasFile(imp) && path.isAbsolute(imp) && !fs.existsSync(imp)) {
          unresolved.push({ file: filePath, import: imp, resolvedTo: null });
        }
      }
    }

    return unresolved;
  }

  /**
   * Phase 3: 查找受文件变更影响的测试文件
   * @param {string} filePath - 起始文件路径
   * @param {number} [maxDepth=5] - 最大搜索深度
    * @returns {Array<{file: string, distance: number, source: string, via?: string[]}>}
   * @description 从起始文件出发，沿反向依赖图 BFS 搜索测试文件
   */
  _findAffectedTestsByGraph(filePath, maxDepth) {
    const isTestFile = (f) => isTestLikeFile(f);
    return bfsTraverse(filePath, (file) => this.getDependents(file), {
      maxDepth,
      onVisit: (file, distance, via) => {
        if (file !== filePath && isTestFile(file)) {
          const result = { file, distance, source: 'graph' };
          if (via.length > 0) result.via = via;
          return result;
        }
        return undefined;
      },
    });
  }

  _findAffectedTestsByHeuristic(filePath, maxDepth, graphResults) {
    const isTestFile = (f) => isTestLikeFile(f);
    const seen = new Set(graphResults.map((entry) => entry.file));
    const sourceSignature = buildHeuristicSignature(this.root, filePath);
    const sourceFamily = getHeuristicLanguageFamily(filePath);
    const sourceLeaf = normalizeHeuristicName(filePath);

    for (const candidate of this.graph.keys()) {
      if (candidate === filePath) continue;
      if (!isTestFile(candidate)) continue;
      if (seen.has(candidate)) continue;

      const candidateFamily = getHeuristicLanguageFamily(candidate);
      if (sourceFamily !== candidateFamily) continue;

      const candidateSignature = buildHeuristicSignature(this.root, candidate);
      const candidateLeaf = normalizeHeuristicName(candidate);

      let signatureMatched = candidateSignature && candidateSignature === sourceSignature;

      // Python fallback for common layouts:
      // source: pkg/module.py  -> tests/test_module.py | tests/module_test.py
      if (!signatureMatched && sourceFamily === 'python-family') {
        signatureMatched =
          Boolean(candidateLeaf) &&
          candidateLeaf === sourceLeaf &&
          Boolean(sourceSignature) &&
          sourceSignature.endsWith(`/${sourceLeaf}`);
      }

      // L2-10: general leaf-name fallback for flat test directories
      // e.g. src/utils/request.js -> tests/request.test.js
      // Only match when the test has a flat signature (single segment) to avoid
      // cross-module false positives like src/feature.js -> tests/group-b/feature.test.js
      if (!signatureMatched && candidateLeaf && candidateLeaf === sourceLeaf) {
        const isFlatTest = !candidateSignature.includes('/');
        if (isFlatTest) {
          signatureMatched = true;
        }
      }

      if (signatureMatched) {
        graphResults.push({
          file: candidate,
          distance: maxDepth + 1,
          source: 'heuristic',
          via: ['heuristic:naming'],
        });
        seen.add(candidate);
      }
    }
  }

  findAffectedTests(filePath, maxDepth = CONFIG.DEFAULT_MAX_DEPTH, options = {}) {
    const start = this.normalizeFilePath(filePath);
    const results = this._findAffectedTestsByGraph(start, maxDepth);
    if (options?.includeHeuristic !== false) {
      this._findAffectedTestsByHeuristic(start, maxDepth, results);
    }
    return results;
  }

  getScopeSummary() {
    const files = Array.from(this.cache.fileMetadata.keys()).filter((file) => {
      if (this.shouldExclude(file)) return false;
      if (this.shouldExcludeCli(file)) return false;
      return true;
    });
    if (this.projectContext) {
      return this.projectContext.summarizeFiles(files, (file) => this.getDependents(file).length > 0);
    }

    return {
      configPath: null,
      hasWorkspaceBridgeConfig: false,
      counts: {
        totalFiles: files.length,
        mainlineFiles: files.length,
        nonMainlineFiles: 0,
        testFiles: files.filter((f) => this.isTestLikeFile(f)).length,
      },
      directoryRoles: {
        active: files.length,
        reference: 0,
        archive: 0,
        generated: 0,
      },
      fileRoles: {
        entry: 0,
        library: files.length,
        config: 0,
        test: 0,
        migration: 0,
        script: 0,
      },
      entryFiles: [],
    };
  }
}

module.exports = {
  DependencyGraph,
};

