/**
 * GraphAnalyzer - Dependency Graph Analysis & Query Engine
 * Performs post-link tasks: topological sorting, cycle detection, PageRank, and dead export analysis.
 *
 * Architecture Phases:
 * - Parse Phase: Occurs in GraphBuilder (independent file scanning and symbol database population).
 * - Link Phase: Occurs here in GraphAnalyzer. Once files are parsed, they are linked into a resolved
 *   import-export dependency graph. This analyzer computes graph metrics and answers impact queries.
 */
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
const { fromNormalizedKey, normalizePathKey } = require('../../utils/path');
const {
  CONFIG,
  bfsTraverse,
  isLikelyConstantsWarehouse,
  computeDeadExportConfidence,
  DEAD_EXPORT_FILTER_RE,
  isConventionallyAliveSymbol,
} = require('./shared');

// Defensive: exclude workspace-bridge's own tree-sitter query registry files
// from dead-export analysis. These files are dynamically required by
// framework-patterns.js and would otherwise be flagged as unused exports.
// Using an exact directory prefix instead of a broad /queries/ regex avoids
// accidentally ignoring user source files in a queries/ directory.
const QUERIES_DIR = normalizePathKey(path.join(__dirname, 'queries'));

// Known registry exports that are intentionally exposed for dynamic/runtime
// consumption (e.g. consumed via string-based require or external tooling)
// but appear unused to static analysis. These findings are downgraded to low
// confidence and excluded from severity-driven recommendations while still
// being surfaced in the dead-exports list for transparency.
const KNOWN_REGISTRY_EXPORTS = [
  {
    pathSuffix: '/src/services/dep-graph/shadow-candidates.js',
    exports: new Set(['SHADOW_EXTS']),
  },
];

/**
 * Strip comments and docstrings from source content before running
 * mention-style heuristic matching. This prevents a test file from being
 * flagged as "affected" just because it mentions a source stem in a comment.
 *
 * Note: This is a heuristic preprocessor, not a parser. It intentionally
 * trades perfect string-literal accuracy for simplicity and speed.
 */
function stripComments(content, languageFamily) {
  if (!content) return content;

  // C-style comments cover the majority of supported languages:
  // JS/TS, Java/Kotlin, Go, Rust, C/C++, Vue, Svelte.
  if (
    languageFamily === 'js-family' ||
    languageFamily === 'java-family' ||
    languageFamily === 'go-family' ||
    languageFamily === 'rust-family'
  ) {
    return stripCFamilyComments(content);
  }

  if (languageFamily === 'python-family' || languageFamily === 'ruby-family') {
    return stripHashFamilyComments(content, languageFamily === 'python-family');
  }

  // Unknown/other families: do not strip; keep existing behavior.
  return content;
}

/**
 * Remove hash-style line comments while preserving string literals.
 * Supports Python triple-quoted strings/docstrings and single/double quotes
 * with escape sequences. Ruby here-docs and `%q`/`%w` literals are not parsed.
 */
function stripHashFamilyComments(content, supportTripleQuotes) {
  let result = '';
  let i = 0;
  while (i < content.length) {
    const ch = content[i];
    const next = content[i + 1];
    const next2 = content[i + 2];

    // Python triple-quoted strings/docstrings.
    if (
      supportTripleQuotes &&
      ((ch === '"' && next === '"' && next2 === '"') || (ch === "'" && next === "'" && next2 === "'"))
    ) {
      const quote = ch === '"' ? '"""' : "'''";
      let j = i + 3;
      while (j < content.length - 2) {
        if (content[j] === '\\') {
          j += 2;
        } else if (content.slice(j, j + 3) === quote) {
          j += 3;
          break;
        } else {
          j += 1;
        }
      }
      result += content.slice(i, j);
      i = j;
      continue;
    }

    // Single/double-quoted strings.
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      while (j < content.length) {
        if (content[j] === '\\') {
          j += 2;
        } else if (content[j] === quote) {
          j += 1;
          break;
        } else {
          j += 1;
        }
      }
      result += content.slice(i, j);
      i = j;
      continue;
    }

    // Line comment.
    if (ch === '#') {
      result += ' ';
      let j = i + 1;
      while (j < content.length && content[j] !== '\n') {
        j += 1;
      }
      i = j;
      continue;
    }

    result += ch;
    i += 1;
  }
  return result;
}

/**
 * Remove C-style comments while preserving string literals.
 * Handles single/double/backtick quotes and escape sequences.
 * Rust raw strings (r#"..."#) and JS template literal interpolation are not
 * fully parsed; this is intentional for speed.
 */
function stripCFamilyComments(content) {
  let result = '';
  let i = 0;
  while (i < content.length) {
    const ch = content[i];
    const next = content[i + 1];

    // String literals: skip their entire contents so comment-like sequences
    // inside strings are preserved.
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      let j = i + 1;
      while (j < content.length) {
        if (content[j] === '\\') {
          j += 2;
        } else if (content[j] === quote) {
          j += 1;
          break;
        } else {
          j += 1;
        }
      }
      result += content.slice(i, j);
      i = j;
      continue;
    }

    // Block comment.
    if (ch === '/' && next === '*') {
      let j = i + 2;
      while (j < content.length - 1 && !(content[j] === '*' && content[j + 1] === '/')) {
        j += 1;
      }
      result += ' ';
      i = j + 2;
      continue;
    }

    // Line comment.
    if (ch === '/' && next === '/') {
      result += ' ';
      let j = i + 2;
      while (j < content.length && content[j] !== '\n') {
        j += 1;
      }
      i = j;
      continue;
    }

    result += ch;
    i += 1;
  }
  return result;
}

class GraphAnalyzer {
  constructor(depGraph) {
    this.dg = depGraph;
    this._pageRanks = null;
    this._aggregateCache = null;
    this._aggregateVersion = 0;
    this._impactCache = new Map();
    this._impactVersion = 0;
    this._testMapCache = new Map();

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
    const deadExports = this.findDeadExports({ skipCache: true, raw: true });
    const unresolved = this.findUnresolvedImports({ skipCache: true, raw: true });
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
          let reason = level === 1 ? 'direct-import' : 'transitive-dependency';
          if (currentInfo?.importRecords) {
            const parentFile = via[via.length - 1];
            const matchingImports = currentInfo.importRecords.filter((r) => r.resolved === parentFile);
            for (const record of matchingImports) {
              if (record.imported) importedSymbols.push(...record.imported);
            }
            importedSymbolsAvailable = matchingImports.length > 0 && matchingImports.some((r) => r.imported && r.imported.length > 0);
            if (matchingImports.some((r) => r.resolutionMethod === 'java-same-package')) {
              reason = 'implicit-same-package';
            }
          }
          impactRadius.push({
            file: f,
            level,
            via: [...via],
            importedSymbols: [...new Set(importedSymbols)],
            importedSymbolsAvailable,
            reason,
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
    const expectedVersion = rows[0].version;
    for (const row of rows) {
      if (row.fileCount !== graphSize) return false;
      if (row.version !== expectedVersion) return false;
    }

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

  getAggregateVersion() {
    return this._aggregateVersion;
  }

  clearScanCaches() {
    this._scanContentCache.clear();
    this._scanPatternCache.clear();
  }

  injectPrecomputedTestMap(rows) {
    if (!rows) return false;
    this._testMapCache.clear();
    for (const row of rows) {
      if (!this._testMapCache.has(row.source)) {
        this._testMapCache.set(row.source, []);
      }
      this._testMapCache.get(row.source).push(row);
    }
    return true;
  }

  injectPrecomputedMetrics(rows) {
    if (!rows) return false;
    if (!this._pageRanks) this._pageRanks = new Map();
    for (const row of rows) {
      if (row.dimension === 'pagerank') {
        this._pageRanks.set(row.file, row.value);
      }
    }
    return true;
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
    // Verify consistency: all rows should share the same version
    const expectedVersion = rows[0].version;
    for (const row of rows) {
      if (row.version !== expectedVersion) return false;
    }

    this._impactCache.clear();
    this._impactVersion++;
    for (const row of rows) {
      let affectedTests = [];
      let impactRadius = null;
      try {
        if (row.affectedTests) affectedTests = JSON.parse(row.affectedTests);
      } catch {
        // ignore corrupted
      }
      try {
        if (row.impactRadius) impactRadius = JSON.parse(row.impactRadius);
      } catch {
        // ignore corrupted — will fall back to BFS on query
      }
      const entry = {
        directDeps: row.directDeps,
        transitiveDeps: row.transitiveDeps,
        directDependents: row.directDependents,
        transitiveDependents: row.transitiveDependents,
        affectedTests,
      };
      if (impactRadius) entry.impactRadius = impactRadius;
      this._impactCache.set(row.file, entry);
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

  _getCircularDependencies(filePath) {
    const key = this.dg.normalizeFilePath(filePath);
    const info = this.dg.graph.get(key);
    if (!info || !info.imports || info.imports.length === 0) {
      return [];
    }

    const filtered = [];
    for (const imp of info.imports) {
      const record = info.importRecords?.find((r) => r.resolved === imp);
      if (record) {
        // Rule 1 (Lazy/Dynamic): Filter out if record.isLazy is true.
        if (record.isLazy) {
          continue;
        }
      }

      // Rule 4 (MVVM/MVC View Boundary)
      // If the source path is a logic/model file (/store/, /router/, /api/, etc.)
      // and target path is a Vue/React component (.vue, .jsx, .tsx or /views/, /pages/, etc.),
      // discard the edge.
      const sourcePathLower = key.toLowerCase().replace(/\\/g, '/');
      const targetPathLower = imp.toLowerCase().replace(/\\/g, '/');
      
      const isSourceLogic = /\/(store|router|api|services|models|logic|controllers)\//.test(sourcePathLower) ||
        /(?:store|router|api|service|model|controller)\./i.test(sourcePathLower);
      const isTargetView = /\.(vue|jsx|tsx)$/.test(targetPathLower) ||
        /\/(views|pages|components)\//.test(targetPathLower);

      if (isSourceLogic && isTargetView) {
        continue;
      }

      filtered.push(imp);
    }
    // Defensive dedup: a file may have multiple import records resolving to the same target.
    return [...new Set(filtered)];
  }

  findCircularDependencies(options = {}) {
    // P85: return cached filtered cycles so all consumers see the same data.
    if (!options?.skipCache && this._aggregateCache && this._aggregateCache.version === this._aggregateVersion) {
      return this._aggregateCache.cycles;
    }
    if (this._cachedCycles) {
      return this._cachedCycles;
    }

    // 1. Tarjan's algorithm to find all strongly connected components (SCCs) in O(V + E)
    let index = 0;
    const stack = [];
    const indices = new Map();
    const lowlinks = new Map();
    const onStack = new Set();
    const sccs = [];

    const strongconnect = (v) => {
      indices.set(v, index);
      lowlinks.set(v, index);
      index++;
      stack.push(v);
      onStack.add(v);

      const deps = this._getCircularDependencies(v);
      for (const w of deps) {
        if (!this.dg.hasFile(w)) continue;
        if (!indices.has(w)) {
          strongconnect(w);
          lowlinks.set(v, Math.min(lowlinks.get(v), lowlinks.get(w)));
        } else if (onStack.has(w)) {
          lowlinks.set(v, Math.min(lowlinks.get(v), indices.get(w)));
        }
      }

      if (lowlinks.get(v) === indices.get(v)) {
        const scc = [];
        let w;
        do {
          w = stack.pop();
          onStack.delete(w);
          scc.push(w);
        } while (w !== v);
        sccs.push(scc);
      }
    };

    for (const v of this.dg.graph.keys()) {
      if (this.dg.shouldExcludeCli(v)) continue;
      if (!indices.has(v)) {
        strongconnect(v);
      }
    }

    // 2. Find all simple cycles within each SCC of size > 1 using Johnson's algorithm
    const cycles = [];
    let calls = 0;
    // MAX_CYCLE_EDGE_DEPTH limits the Johnson search depth before push.
    // pathStack.length > 7 triggers prune, so the maximum nodes in any
    // discovered cycle = 8 (8 edges when the loop closes).
    const MAX_CYCLE_EDGE_DEPTH = DEFAULTS.AFFECTED_TEST_DEPTH + 2; // conservative guard

    for (const scc of sccs) {
      if (cycles.length >= 1000 || calls >= LIMITS.CYCLE_FINDER_MAX_CALLS) break;
      if (scc.length <= 1) continue; // Skip SCCs of size 1 (which have no multi-node cycles)

      const sccSet = new Set(scc);
      const blocked = new Set();
      const blockedMap = new Map();
      const pathStack = [];
      const sccList = Array.from(scc);
      const nodeToIndex = new Map(sccList.map((node, idx) => [node, idx]));

      const find = (startNode, currentNode) => {
        calls++;
        if (cycles.length >= 1000 || calls >= LIMITS.CYCLE_FINDER_MAX_CALLS) {
          return false;
        }
        // MAX_CYCLE_EDGE_DEPTH limits the size of the pathStack before pushing the next node.
        // If pathStack.length is exactly MAX_CYCLE_EDGE_DEPTH (e.g. 7), the guard allows us to push 
        // the 8th node. If that 8th node connects back to startNode, a cycle of length 8 
        // is discovered. Hence, the maximum reported cycle length is MAX_CYCLE_EDGE_DEPTH + 1 = 8.
        if (pathStack.length > MAX_CYCLE_EDGE_DEPTH) {
          return false;
        }

        let foundCycle = false;
        pathStack.push(currentNode);
        blocked.add(currentNode);

        const deps = this._getCircularDependencies(currentNode);
        for (const dep of deps) {
          if (!this.dg.hasFile(dep) || !sccSet.has(dep)) continue;
          if (nodeToIndex.get(dep) < nodeToIndex.get(startNode)) continue;

          if (dep === startNode) {
            cycles.push([...pathStack]);
            foundCycle = true;
          } else if (!blocked.has(dep)) {
            if (find(startNode, dep)) {
              foundCycle = true;
            }
          }
        }

        if (foundCycle) {
          unblock(currentNode);
        } else {
          for (const dep of deps) {
            if (!this.dg.hasFile(dep) || !sccSet.has(dep)) continue;
            if (nodeToIndex.get(dep) < nodeToIndex.get(startNode)) continue;
            if (!blockedMap.has(dep)) blockedMap.set(dep, new Set());
            blockedMap.get(dep).add(currentNode);
          }
        }

        pathStack.pop();
        return foundCycle;
      };

      const unblock = (node) => {
        blocked.delete(node);
        if (blockedMap.has(node)) {
          for (const blockedNode of blockedMap.get(node)) {
            if (blocked.has(blockedNode)) {
              unblock(blockedNode);
            }
          }
          blockedMap.delete(node);
        }
      };

      for (let i = 0; i < sccList.length; i++) {
        if (cycles.length >= 1000 || calls >= LIMITS.CYCLE_FINDER_MAX_CALLS) break;
        const startNode = sccList[i];
        pathStack.length = 0;
        blocked.clear();
        blockedMap.clear();
        find(startNode, startNode);
      }
    }

    const filtered = cycles
      .filter((cycle) => !(cycle.length <= 2 && cycle[0] === cycle[cycle.length - 1]));

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

  /**
   * Downgrade dead-export findings that are known registry exports exposed for
   * dynamic/runtime consumption but invisible to static analysis.
   */
  _markKnownRegistryFalsePositives(deadExports) {
    for (const finding of deadExports) {
      if (!finding.exports || finding.exports.length === 0) continue;
      const normalizedFile = normalizePathKey(finding.file);
      const match = KNOWN_REGISTRY_EXPORTS.find((rule) =>
        normalizedFile.endsWith(rule.pathSuffix) &&
        finding.exports.every((e) => rule.exports.has(e))
      );
      if (!match) continue;
      finding.confidence = 'low';
      finding.confidenceValue = CONFIDENCE.LOW_VALUE;
      finding.confidenceSource = 'dynamic-registry-export';
      finding.confidenceReason = 'Export is part of a dynamic registry API not visible to static analysis';
      finding.falsePositiveReason = 'dynamic-registry-export';
    }
  }

  /**
   * Downgrade dead-export findings that live in Rust library public API modules.
   * A crate's src/lib.rs re-exports modules via `pub mod <name>;`; those modules
   * may in turn re-export submodules. The `pub` items inside these modules are
   * intended for external consumers and static analysis within the workspace
   * cannot see cross-crate usage. Mark them as known false positives so they do
   * not drive severity while staying visible.
   */
  _markRustPublicApiFalsePositives(deadExports) {
    const publicApiFiles = new Set();

    // Find each crate root (src/lib.rs) and walk the public module tree.
    for (const [filePath, info] of this.dg.graph) {
      if (!filePath.endsWith('/lib.rs') && !filePath.endsWith('\\lib.rs')) continue;
      if (!info?.exportRecords) continue;

      const crateSrcDir = path.dirname(filePath);
      const queue = [];
      for (const record of info.exportRecords) {
        if (record.kind !== 'module' || !record.name) continue;
        queue.push(record.name);
      }

      const visited = new Set();
      while (queue.length > 0) {
        const modName = queue.shift();
        if (visited.has(modName)) continue;
        visited.add(modName);

        // Rust module file resolution: src/<name>.rs or src/<name>/mod.rs
        const candidates = [
          normalizePathKey(path.join(crateSrcDir, `${modName}.rs`)),
          normalizePathKey(path.join(crateSrcDir, modName, 'mod.rs')),
        ];

        for (const candidate of candidates) {
          if (publicApiFiles.has(candidate)) continue;
          publicApiFiles.add(candidate);

          const modInfo = this.dg.graph.get(candidate);
          if (!modInfo?.exportRecords) continue;
          for (const record of modInfo.exportRecords) {
            if (record.kind !== 'module' || !record.name) continue;
            // Submodule paths are relative to the parent module file.
            // lib.rs -> foo -> bar resolves to src/foo/bar.rs or src/foo/bar/mod.rs.
            queue.push(`${modName}/${record.name}`);
          }
        }
      }
    }

    if (publicApiFiles.size === 0) return;

    for (const finding of deadExports) {
      if (!finding.exports || finding.exports.length === 0) continue;
      if (finding.falsePositiveReason) continue;
      const normalizedFile = normalizePathKey(finding.file);
      if (!publicApiFiles.has(normalizedFile)) continue;
      finding.confidence = 'low';
      finding.confidenceValue = CONFIDENCE.LOW_VALUE;
      finding.confidenceSource = 'rust-public-api';
      finding.confidenceReason = 'Module is part of the Rust public API surface; cross-crate usage is invisible to static analysis';
      finding.falsePositiveReason = 'rust-public-api';
    }
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
    let deadExports;
    if (!options?.skipCache && this._aggregateCache && this._aggregateCache.version === this._aggregateVersion) {
      deadExports = this._aggregateCache.deadExports;
    } else {
      deadExports = [];

      for (const [filePath, info] of this.dg.graph) {
        if (this.dg.shouldExcludeCli(filePath)) continue;
        if (info.exports.length === 0) continue;
        if (this.dg.isTestLikeFile(filePath)) continue;
        if (this.dg.isKnownEntryFile(filePath, info.exports)) continue;
        // Rule 2: .d.ts ambient declaration files are type-only, not runtime exports
        if (filePath.endsWith('.d.ts')) continue;
        // Ignore workspace-bridge's own tree-sitter query registry files
        if (filePath.startsWith(QUERIES_DIR)) continue;
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
          deadExports.push({ id: `dead-export:${this.dg._displayPath(filePath)}`, category: 'dead-exports', file: this.dg._displayPath(filePath), exports: filteredExports, confidence, confidenceValue, confidenceSource: source, confidenceReason: reason, importerCount: 0, scaffold, ...(duplicateOf ? { duplicateOf } : {}) });
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
            id: `dead-export:${this.dg._displayPath(filePath)}`,
            category: 'dead-exports',
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

      // Downgrade known registry false positives before returning. These exports
      // are intentionally public for dynamic/runtime consumers that static
      // analysis cannot see, so they should not drive severity.
      this._markKnownRegistryFalsePositives(deadExports);

      // Downgrade Rust library public API modules. Items re-exported by
      // src/lib.rs are meant for external crate consumers and appear unused
      // when only the workspace itself is analyzed.
      this._markRustPublicApiFalsePositives(deadExports);

      // L1: _scanContentCache holds full file contents (up to 50MB). Clear after
      // each findDeadExports call so REPL long sessions don't leak memory when
      // dead-exports is invoked repeatedly without file changes.
      this._scanContentCache.clear();
    }

    if (options?.raw) {
      return deadExports;
    }

    const ignoreFindings = this.dg.projectContext?.config?.ignore?.findings;
    if (ignoreFindings?.length > 0) {
      const ignoredSet = new Set(ignoreFindings);
      return deadExports.filter((f) => !ignoredSet.has(f.id));
    }
    return deadExports;
  }

  findUnresolvedImports(options = {}) {
    let unresolved;
    if (!options?.skipCache && this._aggregateCache && this._aggregateCache.version === this._aggregateVersion) {
      unresolved = this._aggregateCache.unresolved;
    } else {
      unresolved = [];

      for (const [filePath, info] of this.dg.graph) {
        if (this.dg.shouldExcludeCli(filePath)) continue;
        for (const imp of info.imports) {
          const fsPath = fromNormalizedKey(imp);
          if (!this.dg.hasFile(imp) && path.isAbsolute(fsPath) && !fs.existsSync(fsPath)) {
            unresolved.push({ id: `unresolved:${this.dg._displayPath(filePath)}:${this.dg._displayPath(imp)}`, category: 'unresolved', file: this.dg._displayPath(filePath), import: this.dg._displayPath(imp), resolvedTo: null });
          }
        }
      }
    }

    if (options?.raw) {
      return unresolved;
    }

    const ignoreFindings = this.dg.projectContext?.config?.ignore?.findings;
    if (ignoreFindings?.length > 0) {
      const ignoredSet = new Set(ignoreFindings);
      return unresolved.filter((f) => !ignoredSet.has(f.id));
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
    // Heuristic signatures should be computed from the original-casing path
    // (stored in node.originalPath), not from the normalized graph key, so
    // case-sensitive suffix stripping (e.g. Java *Tests / *IT) stays correct.
    const sourceInfo = this.dg.getFileInfo(filePath);
    const sourcePath = sourceInfo?.originalPath || filePath;
    const sourceSignature = buildHeuristicSignature(this.dg.root, sourcePath);
    const sourceFamily = getHeuristicLanguageFamily(sourcePath);
    const sourceLeaf = normalizeHeuristicName(sourcePath);

    for (const candidate of this.dg.graph.keys()) {
      if (candidate === filePath) continue;
      if (!isTestFile(candidate)) continue;
      if (seen.has(candidate)) continue;

      const candidateInfo = this.dg.graph.get(candidate);
      const candidatePath = candidateInfo?.originalPath || candidate;
      const candidateFamily = getHeuristicLanguageFamily(candidatePath);
      if (sourceFamily !== candidateFamily) continue;

      const candidateSignature = buildHeuristicSignature(this.dg.root, candidatePath);
      const candidateLeaf = normalizeHeuristicName(candidatePath);

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
          terminator: true,
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
      const candidateFamily = getHeuristicLanguageFamily(candidate);
      const searchableContent = stripComments(content, candidateFamily);
      if (mentionPattern.test(searchableContent)) {
        graphResults.push({
          file: candidate,
          distance: maxDepth + 1,
          source: 'mention',
          via: ['mention:stem'],
          terminator: true,
        });
        seen.add(candidate);
      }
    }
  }

  findAffectedTests(filePath, maxDepth = CONFIG.DEFAULT_MAX_DEPTH, options = {}) {
    const start = this.dg.normalizeFilePath(filePath);

    // Fast path: if cache has precomputed test map for this file, return it!
    if (options?.includeHeuristic !== false && this._testMapCache && this._testMapCache.has(start)) {
      const cached = this._testMapCache.get(start);
      const filtered = cached.filter((c) => c.distance <= maxDepth);
      if (filtered.length > 0) {
        return filtered.map((c) => {
          let source = 'graph';
          if (c.signal === 'heuristic') source = 'heuristic';
          else if (c.signal === 'mention') source = 'mention';

          return {
            file: this.dg._displayPath(c.testFile),
            distance: c.distance,
            source,
            via: source === 'graph' ? [] : [source === 'heuristic' ? 'heuristic:naming' : 'mention:stem'],
          };
        });
      }
    }

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

  /**
   * Find all routes from known entry files down to a target file.
   * Returns an array of paths where each path starts at an entry file and
   * ends at the target file. This answers "which request handlers / CLI
   * entry points can reach this module?"
   *
   * @param {string} filePath
   * @param {number} [maxDepth=CONFIG.DEFAULT_MAX_DEPTH]
   * @param {number} [maxRoutes=50]
   * @returns {{entry:string, path:string[], depth:number}[]}
   */
  findAffectedRoutes(filePath, maxDepth = CONFIG.DEFAULT_MAX_DEPTH, maxRoutes = 50) {
    const start = this.dg.normalizeFilePath(filePath);
    const routes = [];
    const visitedGlobal = new Set();

    function dfs(current, depth, pathStack, visitedLocal) {
      if (routes.length >= maxRoutes) return;
      if (depth > maxDepth) return;

      const normalized = current;
      if (visitedLocal.has(normalized)) return;
      visitedLocal.add(normalized);

      // If we reached an entry file (and it's not the start itself), record the route.
      // The route goes from entry -> ... -> target, so we reverse the stack.
      // Skip test-like files as route endpoints — they are not "request handlers".
      if (normalized !== start && this.dg.isKnownEntryFile(normalized) && !this.dg.isTestLikeFile(normalized)) {
        const routePath = [...pathStack, normalized];
        let hasImplicit = false;
        for (let i = 0; i < routePath.length - 1; i++) {
          const prev = routePath[i];
          const curr = routePath[i + 1];
          const info = this.dg.getFileInfo(curr);
          if (info && info.importRecords) {
            const matching = info.importRecords.filter((rec) => rec.resolved === prev);
            if (matching.some((rec) => rec.resolutionMethod === 'java-same-package' || (rec.confidence != null && rec.confidence < 0.5))) {
              hasImplicit = true;
              break;
            }
          }
        }
        routes.push({
          entry: this.dg._displayPath(normalized),
          path: routePath.map((f) => this.dg._displayPath(f)).reverse(),
          depth: routePath.length,
          hasImplicit,
        });
        // Continue searching — an entry may have other parents that are also entries
      }

      const dependents = this.dg.getDependents(normalized);
      for (const dep of dependents) {
        if (routes.length >= maxRoutes) break;
        dfs.call(this, dep, depth + 1, [...pathStack, normalized], new Set(visitedLocal));
      }
    }

    dfs.call(this, start, 0, [], new Set());

    // Deduplicate by JSON-serialized path to avoid duplicate routes from diamond imports
    const seen = new Set();
    const uniqueRoutes = [];
    for (const route of routes) {
      const key = JSON.stringify(route.path);
      if (!seen.has(key)) {
        seen.add(key);
        uniqueRoutes.push(route);
      }
    }

    // Sort uniqueRoutes: non-implicit first, then by depth ascending
    uniqueRoutes.sort((a, b) => {
      if (!a.hasImplicit && b.hasImplicit) return -1;
      if (a.hasImplicit && !b.hasImplicit) return 1;
      return a.depth - b.depth;
    });

    return uniqueRoutes;
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