const fs = require('fs');
const path = require('path');
const { computePageRank } = require('./pagerank');
const {
  normalizeHeuristicName,
  buildHeuristicSignature,
  getHeuristicLanguageFamily,
  isTestLikeFile,
} = require('../../utils/test-detector');
const { detectScaffold } = require('../../utils/scaffold-detector');
const { DEFAULTS, LIMITS, CONFIDENCE } = require('../../config/constants');
const { fromNormalizedKey } = require('../../utils/path');
const {
  CONFIG,
  bfsTraverse,
  isLikelyConstantsWarehouse,
  computeDeadExportConfidence,
  DEAD_EXPORT_FILTER_RE,
  isConventionallyAliveSymbol,
} = require('./shared');
class GraphAnalyzer {
  constructor(depGraph) {
    this.dg = depGraph;
    this._pageRanks = null;
    this._aggregateCache = null;
    this._aggregateVersion = 0;
    this._impactCache = new Map();
    this._impactVersion = 0;

    // Encapsulate caches entirely within analyzer
    this._cachedCycles = null;
    this._cycleCount = undefined;
    this._scanContentCache = new Map();
    this._scanPatternCache = new Map();

    this._cycleFiles = null;

    this.dg.bus.on('graph:updated', (ctx) => {
      this._bumpAggregateCache();
      this._invalidateCycles(ctx);
      this._scanContentCache.clear();
      this._scanPatternCache.clear();
    });
  }

  _bumpAggregateCache() {
    this._aggregateVersion++;
    this._aggregateCache = null;
  }

  /**
   * Fine-grained cycle cache invalidation.
   * Only clear _cachedCycles if the changed files intersect with existing cycles.
   * This avoids O(n) cycle recomputation on every file save in watch mode.
   */
  _invalidateCycles(ctx = {}) {
    if (ctx.fullRebuild) {
      this._cachedCycles = null;
      this._cycleCount = undefined;
      this._cycleFiles = null;
      return;
    }

    if (!this._cachedCycles || !ctx.changedFiles || ctx.changedFiles.length === 0) {
      this._cachedCycles = null;
      this._cycleCount = undefined;
      this._cycleFiles = null;
      return;
    }

    const changedSet = new Set(ctx.changedFiles.map((f) => this.dg.normalizeFilePath(f)));
    const affected = this._cycleFiles && Array.from(changedSet).some((f) => this._cycleFiles.has(f));

    if (affected) {
      this._cachedCycles = null;
      this._cycleCount = undefined;
      this._cycleFiles = null;
    }
    // If no changed file is in any existing cycle, keep the cache.
    // New cycles from new imports are rare in watch-mode incremental edits.
  }

  precomputeAggregates() {
    // If a persistent aggregate was loaded and the graph size hasn't changed,
    // skip recomputation and reuse the loaded cache.
    if (this._aggregateCache && this._aggregateCache.stats?.files === this.dg.graph.size) {
      return;
    }
    const deadExports = this.findDeadExports({ skipCache: true });
    const unresolved = this.findUnresolvedImports({ skipCache: true });
    const cycles = this.findCircularDependencies({ skipCache: true });
    const stats = this.getStats({ skipCache: true });
    this._aggregateCache = {
      version: this._aggregateVersion,
      deadExports,
      unresolved,
      cycles,
      stats,
      hotspots: this._aggregateCache?.hotspots || null,
      stability: this._aggregateCache?.stability || null,
    };
  }

  /**
   * D7: Precompute per-file impact radius (direct/transitive deps & dependents)
   * and affected tests. Results are stored in _impactCache for O(1) queries.
   */
  precomputeImpact() {
    this._impactCache.clear();
    this._impactVersion++;

    for (const [filePath] of this.dg.graph) {
      const directDeps = this.dg.getDependencies(filePath);
      const directDependents = this.dg.getDependents(filePath);

      // Transitive deps via BFS
      const transitiveDeps = new Set();
      bfsTraverse(filePath, (f) => this.dg.getDependencies(f), {
        maxDepth: CONFIG.DEFAULT_MAX_DEPTH,
        onVisit: (f) => {
          if (f !== filePath) transitiveDeps.add(f);
        },
      });

      // Transitive dependents via BFS
      const transitiveDependents = new Set();
      bfsTraverse(filePath, (f) => this.dg.getDependents(f), {
        maxDepth: CONFIG.DEFAULT_MAX_DEPTH,
        onVisit: (f) => {
          if (f !== filePath) transitiveDependents.add(f);
        },
      });

      // Precompute structured impact radius (mirrors GraphQuery.getImpactRadius semantics)
      const impactRadius = [];
      bfsTraverse(filePath, (f) => {
        if (f !== filePath && this.dg.isKnownEntryFile(f)) return [];
        return this.dg.getDependents(f);
      }, {
        maxDepth: CONFIG.DEFAULT_MAX_DEPTH,
        onVisit: (f, level, via) => {
          if (level === 0 || f === filePath) return undefined;
          const currentInfo = this.dg.getFileInfo ? this.dg.getFileInfo(f) : null;
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
          impactRadius.push({
            file: f,
            level,
            via: [...via],
            importedSymbols: [...new Set(importedSymbols)],
            importedSymbolsAvailable,
            reason: level === 1 ? 'direct-import' : 'transitive-dependency',
          });
        },
      });

      // Affected tests (graph-only, without heuristic/mention to keep deterministic)
      const affectedTests = this._findAffectedTestsByGraph(filePath, CONFIG.DEFAULT_MAX_DEPTH);

      this._impactCache.set(filePath, {
        directDeps: directDeps.length,
        transitiveDeps: transitiveDeps.size,
        directDependents: directDependents.length,
        transitiveDependents: transitiveDependents.size,
        impactRadius,
        affectedTests,
      });
    }
  }

  getPrecomputedImpact(filePath) {
    const key = this.dg.normalizeFilePath(filePath);
    return this._impactCache.get(key) || null;
  }

  /**
   * D7: Inject precomputed aggregates from SQLite loadGraph fast path.
   * Only accepts data if version and file_count match current state.
   */
  injectPrecomputedAggregates(rows, graphSize) {
    if (!rows || rows.length === 0) return false;
    // Verify consistency: all rows should share the same version/fileCount
    const first = rows[0];
    if (first.fileCount !== graphSize) return false;

    const injected = {};
    for (const row of rows) {
      try {
        injected[row.key] = JSON.parse(row.data);
      } catch {
        // ignore corrupted row
      }
    }

    // Reconstruct _aggregateCache from injected keys
    const deadExports = injected.deadExports || injected.dead_export || [];
    const unresolved = injected.unresolved || injected.unresolved_import || [];
    const cycles = injected.cycles || injected.cycle || [];
    const stats = injected.stats || {};

    this._aggregateCache = {
      version: this._aggregateVersion,
      deadExports,
      unresolved,
      cycles,
      stats,
      hotspots: injected.hotspots || null,
      stability: injected.stability || null,
    };
    this._syncCycleCache(cycles);
    return true;
  }

  _syncCycleCache(cycles) {
    this._cachedCycles = cycles;
    this._cycleCount = cycles.length;
    this._cycleFiles = new Set();
    for (const cycle of cycles) {
      for (const file of cycle) {
        this._cycleFiles.add(this.dg.normalizeFilePath(file));
      }
    }
  }

  /**
   * Restore aggregate cache from external persisted source (e.g. cache.loadAggregateSummary).
   * Normalizes input and keeps internal schema invariants. Container must not
   * touch _aggregateCache directly — this is the only supported entry point.
   */
  restoreAggregateCache(data) {
    if (!data || typeof data !== 'object') return false;
    this._aggregateVersion = data.version || 0;
    this._aggregateCache = {
      version: this._aggregateVersion,
      deadExports: data.deadExports || data.dead_export || [],
      unresolved: data.unresolved || data.unresolved_import || [],
      cycles: data.cycles || data.cycle || [],
      stats: data.stats || {},
      hotspots: data.hotspots !== undefined ? data.hotspots : null,
      stability: data.stability !== undefined ? data.stability : null,
    };
    this._syncCycleCache(this._aggregateCache.cycles);
    return true;
  }

  /**
   * Set overview-level data (hotspots/stability) without breaking cache invariants.
   * Creates a skeleton cache if none exists yet.
   */
  setOverviewData({ hotspots, stability } = {}) {
    if (!this._aggregateCache) {
      this._aggregateCache = {
        version: this._aggregateVersion,
        deadExports: [],
        unresolved: [],
        cycles: [],
        stats: {},
        hotspots: null,
        stability: null,
      };
    }
    if (hotspots !== undefined) this._aggregateCache.hotspots = hotspots;
    if (stability !== undefined) this._aggregateCache.stability = stability;
  }

  getAggregateCache() {
    return this._aggregateCache;
  }

  clearScanCaches() {
    this._scanContentCache.clear();
    this._scanPatternCache.clear();
  }

  /**
   * D7: Inject precomputed impact from SQLite loadGraph fast path.
   */
  injectPrecomputedImpact(rows, graphSize) {
    if (!rows || rows.length === 0) return false;
    // Light consistency check: if row count differs significantly from graph size,
    // the precomputed data is likely stale.
    if (Math.abs(rows.length - graphSize) > Math.max(1, graphSize * 0.1)) {
      return false;
    }

    this._impactCache.clear();
    this._impactVersion++;
    for (const row of rows) {
      let affectedTests = [];
      try {
        if (row.affectedTests) affectedTests = JSON.parse(row.affectedTests);
      } catch {
        // ignore corrupted
      }
      this._impactCache.set(row.file, {
        directDeps: row.directDeps,
        transitiveDeps: row.transitiveDeps,
        directDependents: row.directDependents,
        transitiveDependents: row.transitiveDependents,
        affectedTests,
      });
    }
    return true;
  }

  computePageRank() {
    const nodes = [];
    const edges = [];
    for (const [filePath, info] of this.dg.graph) {
      nodes.push(filePath);
      for (const imp of info.imports) {
        if (imp !== filePath) {
          edges.push([filePath, imp]);
        }
      }
    }
    // Warm-start: reuse previous ranks if available (graph structure changes
    // are handled gracefully — new nodes get uniform, old nodes keep prev).
    const prevRanks = this.dg.cache?.pageRanks;
    this._pageRanks = computePageRank(nodes, edges, undefined, prevRanks);
    // Persist for next run
    if (this.dg.cache?.savePageRanks) {
      this.dg.cache.savePageRanks(this._pageRanks);
    }
  }

  getPageRank(filePath) {
    if (!this._pageRanks) {
      this.computePageRank();
    }
    const key = this.dg.normalizeFilePath(filePath);
    return this._pageRanks.get(key) || 0;
  }

  getImpactStats(filePath, maxDepth = CONFIG.DEFAULT_MAX_DEPTH) {
    // D7: prefer precomputed impact cache for O(1) queries
    const cached = this.getPrecomputedImpact(filePath);
    if (cached) {
      return {
        direct: cached.directDeps,
        transitive: cached.transitiveDeps,
        dependents: cached.directDependents,
        transitiveDependents: cached.transitiveDependents,
      };
    }
    // Fallback: compute on demand
    const directDeps = this.dg.getDependencies(filePath);
    const directDependents = this.dg.getDependents(filePath);
    const transitiveDeps = new Set();
    bfsTraverse(filePath, (f) => this.dg.getDependencies(f), {
      maxDepth,
      onVisit: (f) => {
        if (f !== filePath) transitiveDeps.add(f);
      },
    });
    const transitiveDependents = new Set();
    bfsTraverse(filePath, (f) => this.dg.getDependents(f), {
      maxDepth,
      onVisit: (f) => {
        if (f !== filePath) transitiveDependents.add(f);
      },
    });
    return {
      direct: directDeps.length,
      transitive: transitiveDeps.size,
      dependents: directDependents.length,
      transitiveDependents: transitiveDependents.size,
    };
  }

  isLikelyFrameworkLegitimateCycle(cycle) {
    const normalized = cycle.map((f) => f.replace(/\\/g, '/').toLowerCase());

    // P96: Vue standard data flow can have length=6 (request→store→router→view→api→request)
    const allInVue = normalized.every(
      (f) =>
        /\/(src|pages|views|components|store|router|layout|layouts|assets|composables|hooks|mixins|directive|directives|plugins|utils|api|http|request|services|service)\//.test(f) ||
        /\.vue$/.test(f)
    );
    const maxLen = allInVue ? 6 : 5;
    if (cycle.length > maxLen) return false;

    // Vue: store ↔ router ↔ view / api / request (length ≤ 6)
    if (allInVue) {
      const hasStore = normalized.some((f) => /\/store\//.test(f));
      const hasRouter = normalized.some((f) => /\/router\//.test(f));
      const hasView = normalized.some((f) => /\.vue$/.test(f) || /\/(views|pages|components|layout|layouts)\//.test(f));
      const hasApi = normalized.some((f) => /\/(api|http|request|services|service)\//.test(f));
      const hasUtils = normalized.some((f) => /\/utils\//.test(f));
      let dimensions = 0;
      if (hasStore) dimensions++;
      if (hasRouter) dimensions++;
      if (hasView) dimensions++;
      if (hasApi) dimensions++;
      if (hasUtils) dimensions++;
      if (dimensions >= 2) return true;
    }

    // P73: React context ↔ hooks ↔ components (length ≤ 4)
    const allInReact = normalized.every(
      (f) =>
        /\/(src|components|hooks?|context|pages|views|lib|utils|api)\//.test(f) ||
        /\.(jsx|tsx)$/.test(f)
    );
    if (allInReact && cycle.length <= 4) {
      const hasContext = normalized.some((f) => /\/context\//.test(f));
      const hasHooks = normalized.some((f) => /\/hooks?\//.test(f));
      const hasComponents = normalized.some((f) => /\/components\//.test(f) || /\.(jsx|tsx)$/.test(f));
      let dimensions = 0;
      if (hasContext) dimensions++;
      if (hasHooks) dimensions++;
      if (hasComponents) dimensions++;
      if (dimensions >= 2) return true;
    }

    // P73: Java domain/model ↔ utils/entity (common module internal cycles, length ≤ 3)
    const allInJava = normalized.every((f) => /\.java$/.test(f));
    if (allInJava && cycle.length <= 3) {
      const hasDomain = normalized.some((f) => /\/(domain|model|entity|po|vo|dto|bo)\//.test(f));
      const hasUtils = normalized.some((f) => /\/(utils|util|common|core|helper|helpers|tools)\//.test(f));
      if (hasDomain && hasUtils) return true;
    }

    // P97: RuoYi scaffold utility mutual dependencies (length ≤ 2)
    if (allInJava && cycle.length <= 2) {
      const hasRuoYiMarker = normalized.some((f) => /\/(ruoyi|common\/utils|common\/core)\//.test(f));
      if (hasRuoYiMarker) {
        const allUtilityLike = normalized.every((f) => {
          const base = path.basename(f);
          if (/(?:utils|formatter|serializer|helper|constants)\.java$/i.test(base)) return true;
          // RuoYi scaffold: annotation/serializer/config pairs are intentional design
          if (/\/(annotation|config|serializer)\//.test(f)) return true;
          return false;
        });
        if (allUtilityLike) return true;
      }
    }

    // Annotation ↔ Serializer mutual dependency (common Java framework design pattern)
    if (allInJava && cycle.length <= 2) {
      const hasAnnotation = normalized.some((f) => /\/annotation\//.test(f));
      const hasSerializer = normalized.some((f) => /\/serializer\//.test(f));
      if (hasAnnotation && hasSerializer) return true;
    }

    return false;
  }

  findCircularDependencies(options = {}) {
    // P85: return cached filtered cycles so all consumers see the same data.
    if (!options?.skipCache && this._aggregateCache && this._aggregateCache.version === this._aggregateVersion) {
      return this._aggregateCache.cycles;
    }
    if (this._cachedCycles) {
      return this._cachedCycles;
    }

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
        const deps = this.dg.getDependencies(file);
        for (const dep of deps) {
          if (this.dg.hasFile(dep)) {
            visit(dep, pathStack);
          }
        }
      } finally {
        pathStack.pop();
        stack.delete(file);
      }
    };

    for (const file of this.dg.graph.keys()) {
      if (this.dg.shouldExcludeCli(file)) continue;
      visit(file, []);
    }

    const filtered = cycles
      .filter((cycle) => !(cycle.length <= 2 && cycle[0] === cycle[cycle.length - 1]))
      .filter((cycle) => !this.isLikelyFrameworkLegitimateCycle(cycle));

    // P89: convert internal graph keys back to original-casing paths for output.
    const displayFiltered = filtered.map((cycle) => cycle.map((f) => this.dg._displayPath(f)));
    this._cachedCycles = displayFiltered;
    this._cycleFiles = new Set(displayFiltered.flatMap((cycle) => cycle.map((f) => this.dg.normalizeFilePath(f))));
    return displayFiltered;
  }

  getStats(options = {}) {
    if (!options?.skipCache && this._aggregateCache && this._aggregateCache.version === this._aggregateVersion) {
      return this._aggregateCache.stats;
    }
    // P85: always use the same filtered cycles array that findCircularDependencies()
    // returns, eliminating any stale-cache divergence between the two paths.
    const cycles = this.findCircularDependencies(options);
    this._cycleCount = cycles.length;
    const cacheStats = this.dg.cache?.getStats?.() || {};
    let parsedFiles = 0;
    let fallbackFiles = 0;
    for (const info of this.dg.graph.values()) {
      if (info.parseMode === 'ast') parsedFiles++;
      else if (info.parseMode === 'regex') fallbackFiles++;
    }
    const totalFiles = this.dg.graph.size;
    const coverageRatio = totalFiles > 0 ? parsedFiles / totalFiles : 0;

    // Compute coverage for the CLI-filtered file set (respects --exclude)
    let filteredParsedFiles = 0;
    let filteredFallbackFiles = 0;
    let filteredTotalFiles = 0;
    for (const [key, info] of this.dg.graph) {
      if (this.dg.shouldExcludeCli(key)) continue;
      filteredTotalFiles++;
      if (info.parseMode === 'ast') filteredParsedFiles++;
      else if (info.parseMode === 'regex') filteredFallbackFiles++;
    }
    const filteredCoverageRatio = filteredTotalFiles > 0 ? filteredParsedFiles / filteredTotalFiles : 0;

    const result = {
      files: totalFiles,
      totalImports: Array.from(this.dg.graph.values()).reduce((sum, i) => sum + i.imports.length, 0),
      totalExports: Array.from(this.dg.graph.values()).reduce((sum, i) => sum + i.exports.length, 0),
      cycles: this._cycleCount,
      totalLines: cacheStats.totalLines || 0,
      analysisCoverage: {
        totalFiles,
        parsedFiles,
        fallbackFiles,
        coverageRatio: Math.round(coverageRatio * 100) / 100,
      },
      filteredAnalysisCoverage: {
        totalFiles: filteredTotalFiles,
        parsedFiles: filteredParsedFiles,
        fallbackFiles: filteredFallbackFiles,
        coverageRatio: Math.round(filteredCoverageRatio * 100) / 100,
      },
    };

    // P94: include fileRoles in stats for consistency with audit-summary
    if (this.dg.projectContext) {
      const scope = this.getScopeSummary();
      result.fileRoles = scope.fileRoles;
    }

    return result;
  }

  buildWarnings() {
    const warnings = [];
    let regexFallbackCount = 0;
    let regexNativeCount = 0;
    let unsupportedCount = 0;

    for (const [, info] of this.dg.graph) {
      if (info.parseModeReason === 'regex-fallback') regexFallbackCount++;
      else if (info.parseModeReason === 'regex-native') regexNativeCount++;
      else if (info.parseModeReason === 'unsupported-extension') unsupportedCount++;
    }

    const total = this.dg.graph.size;
    if (regexFallbackCount > 0) {
      warnings.push({
        type: 'regex-fallback',
        severity: 'medium',
        files: regexFallbackCount,
        message: `${regexFallbackCount} file(s) fell back from AST to regex parsing (possible spawn timeout or WASM failure)`,
      });
    }
    if (unsupportedCount > 0) {
      warnings.push({
        type: 'unsupported-extension',
        severity: 'low',
        files: unsupportedCount,
        message: `${unsupportedCount} file(s) have unsupported extensions and were not parsed`,
      });
    }

    if (this.dg._parseErrorFiles && this.dg._parseErrorFiles.size > 0) {
      warnings.push({
        type: 'parser-error',
        severity: 'medium',
        files: this.dg._parseErrorFiles.size,
        message: `${this.dg._parseErrorFiles.size} file(s) could not be parsed due to errors and were skipped`,
      });
    }

    const stats = this.getStats();
    if (stats.files > 0 && stats.totalImports === 0) {
      warnings.push({
        type: 'empty-graph',
        severity: 'high',
        message: 'Dependency graph has 0 edges; findings may contain false positives',
      });
    }

    return warnings;
  }

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

  _scanLocalSymbolUsage(filePath, symbols) {
    const used = new Set();
    if (!symbols || symbols.length === 0) return used;
    try {
      let content = this._scanContentCache.get(filePath);
      if (content === undefined) {
        content = fs.readFileSync(filePath, 'utf-8');
        if (this._scanContentCache.size < LIMITS.SCAN_SYMBOL_CONTENT_CACHE_MAX) {
          this._scanContentCache.set(filePath, content);
        }
      }
      for (const symbol of symbols) {
        if (used.has(symbol)) continue;
        const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const callPattern = new RegExp(`\\b${escaped}\\s*\\(`);
        const selfAccessPattern = new RegExp(`\\b${escaped}\\.`);
        // Scan line-by-line and skip declaration/export lines to avoid
        // matching the function definition itself (e.g. "function foo()").
        // P74: stream-style scan avoids allocating a temporary array for
        // large files (content.split('\n') creates ~lineCount strings).
        const scanLine = (line) => {
          if (line.includes('export') && line.includes(symbol)) return false;
          if (line.includes('function') && line.includes(symbol)) return false;
          return callPattern.test(line) || selfAccessPattern.test(line);
        };
        let start = 0;
        let end;
        while ((end = content.indexOf('\n', start)) !== -1) {
          if (scanLine(content.slice(start, end))) {
            used.add(symbol);
            break;
          }
          start = end + 1;
        }
        if (!used.has(symbol) && scanLine(content.slice(start))) {
          used.add(symbol);
        }
      }
    } catch {
      // ignore read errors
    }
    return used;
  }

  _collectUsedExports(importers, filePath) {
    let usesAllExports = false;
    const usedNames = new Set();

    for (const importerPath of importers) {
      const importerInfo = this.dg.getFileInfo(importerPath);
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

  _findDuplicateOf(symbolName, currentFile) {
    const registry = this.dg.symbolRegistry;
    if (!registry) return null;
    const locations = registry.lookup(symbolName);
    const others = locations.filter((loc) => loc.file !== currentFile);
    if (others.length === 0) return null;
    const loc = others[0];
    const line = loc.lineStart ?? 1;
    return `${this.dg._displayPath(loc.file)}:${line}`;
  }

  _buildDuplicateOf(exports, filePath) {
    const duplicateOf = {};
    for (const exp of exports) {
      const dup = this._findDuplicateOf(exp, filePath);
      if (dup) duplicateOf[exp] = dup;
    }
    return Object.keys(duplicateOf).length > 0 ? duplicateOf : undefined;
  }

  findDeadExports(options = {}) {
    if (!options?.skipCache && this._aggregateCache && this._aggregateCache.version === this._aggregateVersion) {
      return this._aggregateCache.deadExports;
    }
    const deadExports = [];

    for (const [filePath, info] of this.dg.graph) {
      if (this.dg.shouldExcludeCli(filePath)) continue;
      if (info.exports.length === 0) continue;
      if (this.dg.isTestLikeFile(filePath)) continue;
      if (this.dg.isKnownEntryFile(filePath, info.exports)) continue;
      // Rule 2: .d.ts ambient declaration files are type-only, not runtime exports
      if (filePath.endsWith('.d.ts')) continue;
      // P78: Detect scaffold once per file, reuse in both output branches
      const scaffold = detectScaffold(filePath) || undefined;
      const importers = this.dg.getDependents(filePath);
      if (importers.length === 0) {
        // When the dependency graph has many files but suspiciously few edges,
        // the parser may be unavailable or the project uses an unsupported module
        // system. Downgrade confidence to avoid high-confidence false positives.
        const stats = this.getStats();
        const edgeRatio = stats.files > 0 ? stats.totalImports / stats.files : 0;
        const graphUnreliable = stats.files > 1 && edgeRatio < 0.1;
        if (scaffold) continue;
        const filteredExports = info.exports.filter(isConventionallyAliveSymbol);
        if (filteredExports.length === 0) continue;
        const { confidence, confidenceValue, source, reason } = computeDeadExportConfidence(0, info.parseMode, graphUnreliable);
        const duplicateOf = this._buildDuplicateOf(filteredExports, filePath);
        deadExports.push({ file: this.dg._displayPath(filePath), exports: filteredExports, confidence, confidenceValue, confidenceSource: source, confidenceReason: reason, importerCount: 0, scaffold, ...(duplicateOf ? { duplicateOf } : {}) });
        continue;
      }

      const { usedNames, usesAllExports } = this._collectUsedExports(importers, filePath);
      if (usesAllExports) continue;

      let unused = info.exports.filter((name) => !usedNames.has(name) && isConventionallyAliveSymbol(name));

      // P1: 轻量扫描 importer 文件中的实际使用点，消除 importRecords 未 capture 的误报
      if (unused.length > 0) {
        const scannedUsed = this._scanSymbolUsageInImporters(importers, unused, filePath);
        unused = unused.filter((name) => !scannedUsed.has(name));
      }

      // L3-1: 扫描模块内部使用（同文件内的函数调用/属性访问），消除 barrel/internal-use 误报
      if (unused.length > 0) {
        const locallyUsed = this._scanLocalSymbolUsage(filePath, unused);
        unused = unused.filter((name) => !locallyUsed.has(name));
      }

      if (unused.length > 0) {
        const isConstantsWarehouse = isLikelyConstantsWarehouse(filePath, info.exportRecords);
        if (isConstantsWarehouse || scaffold) continue;
        const { confidence, confidenceValue, source, reason } = computeDeadExportConfidence(importers.length, info.parseMode, false);
        const duplicateOf = this._buildDuplicateOf(unused, filePath);
        deadExports.push({
          file: this.dg._displayPath(filePath),
          exports: unused,
          confidence: isConstantsWarehouse ? 'low' : confidence,
          confidenceValue: isConstantsWarehouse ? CONFIDENCE.LOW_VALUE : confidenceValue,
          confidenceSource: isConstantsWarehouse ? 'java-constants-warehouse' : source,
          confidenceReason: isConstantsWarehouse
            ? 'File matches Java constants-warehouse pattern; individual constants may be referenced via static import or reflection, bypassing static analysis'
            : reason,
          importerCount: importers.length,
          scaffold,
          ...(duplicateOf ? { duplicateOf } : {}),
        });
      }
    }

    // L1: _scanContentCache holds full file contents (up to 50MB). Clear after
    // each findDeadExports call so REPL long sessions don't leak memory when
    // dead-exports is invoked repeatedly without file changes.
    this._scanContentCache.clear();

    return deadExports;
  }

  findUnresolvedImports(options = {}) {
    if (!options?.skipCache && this._aggregateCache && this._aggregateCache.version === this._aggregateVersion) {
      return this._aggregateCache.unresolved;
    }
    const unresolved = [];

    for (const [filePath, info] of this.dg.graph) {
      if (this.dg.shouldExcludeCli(filePath)) continue;
      for (const imp of info.imports) {
        const fsPath = fromNormalizedKey(imp);
        if (!this.dg.hasFile(imp) && path.isAbsolute(fsPath) && !fs.existsSync(fsPath)) {
          unresolved.push({ file: this.dg._displayPath(filePath), import: this.dg._displayPath(imp), resolvedTo: null });
        }
      }
    }

    return unresolved;
  }

  _findAffectedTestsByGraph(filePath, maxDepth) {
    const isTestFile = (f) => isTestLikeFile(f);
    return bfsTraverse(filePath, (file) => this.dg.getDependents(file), {
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
    const sourceSignature = buildHeuristicSignature(this.dg.root, filePath);
    const sourceFamily = getHeuristicLanguageFamily(filePath);
    const sourceLeaf = normalizeHeuristicName(filePath);

    for (const candidate of this.dg.graph.keys()) {
      if (candidate === filePath) continue;
      if (!isTestFile(candidate)) continue;
      if (seen.has(candidate)) continue;

      const candidateFamily = getHeuristicLanguageFamily(candidate);
      if (sourceFamily !== candidateFamily) continue;

      const candidateSignature = buildHeuristicSignature(this.dg.root, candidate);
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

  _findAffectedTestsByMention(filePath, maxDepth, graphResults) {
    const isTestFile = (f) => isTestLikeFile(f);
    const seen = new Set(graphResults.map((entry) => entry.file));
    const sourceStem = path.basename(filePath, path.extname(filePath));
    // Minimum stem length to avoid false positives on generic names like "a", "x", "index"
    if (!sourceStem || sourceStem.length < 4) return;
    // Skip mention matching for empty files to avoid false-positive test avalanche
    try {
      if (fs.statSync(filePath).size === 0) return;
    } catch { return; }
    const escapedStem = sourceStem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const mentionPattern = new RegExp(`\\b${escapedStem}\\b`, 'i');
    for (const candidate of this.dg.graph.keys()) {
      if (candidate === filePath) continue;
      if (!isTestFile(candidate)) continue;
      if (seen.has(candidate)) continue;
      let content;
      try {
        content = fs.readFileSync(candidate, 'utf8');
      } catch { continue; }
      if (mentionPattern.test(content)) {
        graphResults.push({
          file: candidate,
          distance: null,
          source: 'mention',
          via: ['mention:stem'],
        });
        seen.add(candidate);
      }
    }
  }

  findAffectedTests(filePath, maxDepth = CONFIG.DEFAULT_MAX_DEPTH, options = {}) {
    const start = this.dg.normalizeFilePath(filePath);
    const results = this._findAffectedTestsByGraph(start, maxDepth);
    if (options?.includeHeuristic !== false) {
      this._findAffectedTestsByHeuristic(start, maxDepth, results);
      this._findAffectedTestsByMention(start, maxDepth, results);
    }
    // P89: convert internal graph keys back to original-casing paths for output.
    return results.map((r) => ({
      ...r,
      file: this.dg._displayPath(r.file),
      via: r.via ? r.via.map((f) => this.dg._displayPath(f)) : r.via,
    }));
  }

  getScopeSummary() {
    // L1 data-consistency: scope must reflect the actual graph so that
    // directoryRoles, deadExports, cycles, and unresolved all refer to the
    // same file set.  Previously we read from cache.fileMetadata, which
    // kept files that GraphBuilder had filtered out (e.g. benchmark/),
    // causing directoryRoles to count files absent from the graph.
    const files = this.dg.getAllFilePaths().filter((file) => {
      if (this.dg.shouldExcludeCli(file)) return false;
      return true;
    });
    if (this.dg.projectContext) {
      return this.dg.projectContext.summarizeFiles(files, (file) => this.dg.getDependents(file).length > 0);
    }

    return {
      configPath: null,
      hasWorkspaceBridgeConfig: false,
      counts: {
        totalFiles: files.length,
        mainlineFiles: files.length,
        nonMainlineFiles: 0,
        testFiles: files.filter((f) => this.dg.isTestLikeFile(f)).length,
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
module.exports = { GraphAnalyzer };