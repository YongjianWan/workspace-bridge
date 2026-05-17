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
const { normalizePathKey, matchesPathFragment, fromNormalizedKey } = require('../utils/path');
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
const { detectScaffold } = require('../tools/scaffold-detector');

const readFile = promisify(fs.readFile);

const { DEFAULTS, LIMITS, DEAD_EXPORT, CONFIDENCE } = require('../config/constants');

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
function isLikelyConstantsWarehouse(filePath, exportRecords) {
  const base = path.basename(filePath).toLowerCase();
  if (!/(constants|status|utils)\.java$/.test(base)) return false;
  if (exportRecords && exportRecords.length > 0) {
    const fieldLike = exportRecords.filter(
      (r) => r.kind === 'field' || r.kind === 'variable' || r.kind === 'const'
    ).length;
    return fieldLike / exportRecords.length >= 0.7;
  }
  return true;
}

function computeDeadExportConfidence(importerCount, parseMode, graphUnreliable) {
  if (importerCount === 0) {
    if (graphUnreliable) {
      return {
        confidence: 'low',
        confidenceValue: CONFIDENCE.LOW_VALUE,
        source: 'graph-sparse',
        reason: 'No importers, but dependency graph is sparse (possible parser miss)',
      };
    }
    return {
      confidence: 'high',
      confidenceValue: CONFIDENCE.HIGH_VALUE,
      source: 'ast-no-importer',
      reason: 'No files import this module; all exports are unused',
    };
  }

  if (parseMode === 'ast') {
    // P87: differentiate reason by importerCount to avoid templated explanations
    const base = {
      confidence: 'medium',
      confidenceValue: CONFIDENCE.MEDIUM_VALUE,
      source: 'ast-unused-exports',
    };
    if (importerCount >= DEAD_EXPORT.IMPORTER_COUNT_HIGH) {
      return { ...base, reason: `File has ${importerCount} importers, but these specific exports are not referenced by any importer` };
    }
    if (importerCount >= DEAD_EXPORT.IMPORTER_COUNT_MEDIUM) {
      return { ...base, reason: `File has ${importerCount} importers; unused exports may be internal helpers or barrel re-exports` };
    }
    return { ...base, reason: 'AST-level analysis found unused exports (dynamic imports or string calls may bypass static detection)' };
  }

  return {
    confidence: 'low',
    confidenceValue: CONFIDENCE.LOW_VALUE,
    source: 'regex-fallback',
    reason: 'Regex-based analysis; high false-positive risk',
  };
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
  /\/management\/commands\/.*\.py$/,
  /\/tasks\.py$/,
  // P71: Django configuration-driven entry points
  /\/middleware.*\.py$/,
  /\/database_router\.py$/,
  /\/context_processors\.py$/,
  /\/templatetags\/.*\.py$/,
  /\/forms\.py$/,
  /\/celery\.py$/,
  /\/(page|layout|loading|error|not-found|route)\.(tsx|jsx|ts|js)$/,
  /\/(template|default)\.(tsx|jsx|ts|js)$/,
];

// #19: known config file names as a Set
const KNOWN_CONFIG_NAMES = new Set(['vite.config.js', 'vite.config.ts', 'vitest.config.ts', 'eslint.config.js']);

// #21: __main__ regex promoted to module-level constant
const PYTHON_MAIN_PATTERN = /if\s+__name__\s*==\s*['"]__main__['"]\s*:/;

// #16-#17: language dispatch now delegated to LanguageRegistry
// see src/services/dep-graph/parsers/registry.js for registration details

class GraphBuilder {
  constructor(depGraph) {
    this.dg = depGraph;
    this.onBuildComplete = null;
    this.onFileUpdated = null;
    // P105: soft post-process phase architecture
    this.postProcessPhases = [];
    this.postProcessPhases.push(() => this.expandJavaPackageImports());
    this.postProcessPhases.push(() => this.applyFrameworkImplicitImports());
  }

  registerPostProcessPhase(fn) {
    this.postProcessPhases.push(fn);
  }

  async build(sourceFiles = null) {
    const startTime = Date.now();

    // Refresh resolver FS caches for each build to avoid stale paths
    clearResolverCaches();

    // Reset graph to prevent ghost data from deleted/renamed files
    this.dg.graph.clear();
    this.dg._cycleCount = undefined;
    this.dg._cachedCycles = null;
    // Clear per-build caches to avoid stale content after rebuild
    this.dg._scanContentCache.clear();
    this.dg._scanPatternCache.clear();

    // Get all files from cache, or use the raw file list provided by file-index
    // so that originalPath preserves platform-native casing and separators.
    const candidateFiles = (sourceFiles || Array.from(this.dg.cache.fileMetadata.keys())).filter((file) => {
      if (this.dg.shouldExclude(file)) return false;
      if (this.dg.projectContext && !this.dg.projectContext.isActiveSourceFile(file)) {
        // L2-12: keep CLI-excluded files in the graph so their imports still
        // protect production code from false positives. They will be filtered
        // out of report output by shouldExcludeCli().
        if (!this.dg.shouldExcludeCli(file)) return false;
      }
      return true;
    });
    const files = [];
    const seen = new Set();
    for (const file of candidateFiles) {
      const key = this.dg.normalizeFilePath(file);
      if (seen.has(key)) continue;
      seen.add(key);
      files.push(file);
    }
    
    // Split: cache hit vs need analysis
    const cachedFiles = [];
    const filesToAnalyze = [];
    for (const file of files) {
      const meta = this.dg.cache.getFileMetadata(file);
      const cached = this.dg.cache.getParseResult(file);
      if (cached && meta && cached.mtime === meta.mtime) {
        const key = this.dg.normalizeFilePath(file);
        // Ensure originalPath uses the platform-native path from sourceFiles
        // even when the cached parse result lacks it (SQLite schema omit).
        this.dg.graph.set(key, { ...cached, originalPath: meta?.originalPath || file });
        cachedFiles.push(file);
      } else {
        filesToAnalyze.push(file);
      }
    }
    
    // Process only changed/new files with concurrency limit
    await this._processFilesWithLimit(filesToAnalyze, CONFIG.DEFAULT_CONCURRENCY);

    // Build reverse graph
    this.buildReverseGraph();

    // P105: run post-process phases (framework implicit imports, etc.)
    for (const phase of this.postProcessPhases) {
      await phase();
    }

    const cacheHitRate = files.length > 0 ? Math.round((cachedFiles.length / files.length) * 100) : 0;
    if (!this.dg.quiet) {
      console.error(`[DepGraph] Built in ${Date.now() - startTime}ms: ${this.dg.graph.size} files (${cacheHitRate}% cached)`);
    }
    // Guard: if graph has files but zero edges, downstream analysis will produce false positives.
    const totalImports = Array.from(this.dg.graph.values()).reduce((sum, i) => sum + i.imports.length, 0);
    if (this.dg.graph.size > 0 && totalImports === 0) {
      console.error('[DepGraph] WARNING: Dependency graph appears empty (0 edges). Results may contain false positives.');
    }

    // P8-1 callback slot
    if (this.onBuildComplete) {
      this.onBuildComplete({ fileCount: this.dg.graph.size, cacheHitRate });
    }
  }

  async _processFilesWithLimit(files, limit) {
    const executing = new Set();

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const promise = this.analyzeFile(file).finally(() => {
        executing.delete(promise);
      });
      executing.add(promise);

      if (executing.size >= limit) {
        await Promise.race(executing);
      }
      // Yield to event loop every 20 files to prevent starvation in large repos
      if ((i + 1) % 20 === 0) {
        await new Promise((r) => setImmediate(r));
      }
    }

    await Promise.all(executing);
  }

  async analyzeFile(filePath) {
    try {
      const graphKey = this.dg.normalizeFilePath(filePath);
      const content = await readFile(filePath, 'utf8');
      const ext = path.extname(filePath);
      
      let imports = [];
      let exports = [];
      let importRecords = [];
      let exportRecords = [];
      let functionRecords = [];
      let parseMode = 'none';
      let packageName = null;

      const entry = registry.findByExt(ext);
      if (entry) {
        const args = entry.needsFilePath ? [content, filePath] : [content];
        const result = entry.async ? await entry.parser(...args) : entry.parser(...args);
        if (result) {
          imports = result.imports;
          exports = result.exports;
          importRecords = result.importRecords || [];
          exportRecords = result.exportRecords || [];
          functionRecords = result.functionRecords || [];
          parseMode = result.parseMode || 'regex';
          packageName = result.package || null;
        }
      }

      // Resolve relative imports to absolute paths
      const resolvedImportRecords = (importRecords.length > 0 ? importRecords : imports.map((source) => createImportRecord(source)))
        .map((record) => {
          const resolved = resolveImport(filePath, record.source, ext, this.dg.root);
          if (!resolved) return null;
          return {
            ...record,
            resolved: this.dg.normalizeFilePath(resolved),
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

      this.dg.graph.set(graphKey, {
        originalPath: filePath,
        imports: resolvedImports,
        exports,
        importRecords: resolvedImportRecords,
        // python.js now returns proper exportRecords (B3 fixed); keep fallback for other parsers
        exportRecords,
        functionRecords: functionRecords.length > 0 ? functionRecords : [],
        parseMode,
        parseModeReason,
        confidence: parseMode === 'ast' ? 'high' : 'medium',
        package: packageName,
      });

      // Cache parse result for incremental rebuilds
      const meta = this.dg.cache.getFileMetadata(filePath);
      if (meta) {
        this.dg.cache.setParseResult(filePath, {
          ...this.dg.graph.get(graphKey),
          mtime: meta.mtime,
        });
      }

    } catch (e) {
      // 单个文件分析失败不应阻塞整个依赖图构建，记录日志后继续
      console.error(`[DepGraph] Failed to analyze ${filePath}:`, e.message);
      // 删除 stale 记录，防止增量更新时 reverseGraph 与实际内容脱节
      this.dg.graph.delete(this.dg.normalizeFilePath(filePath));
      this.dg.cache.deleteParseResult(filePath);
    }
  }

  _addReverseEdges(fileKey, imports, options = {}) {
    const { skipExisting = false } = options;
    const seen = new Set();
    for (const imp of imports) {
      if (seen.has(imp)) continue;
      seen.add(imp);
      if (!this.dg.reverseGraph.has(imp)) {
        this.dg.reverseGraph.set(imp, []);
      }
      const dependents = this.dg.reverseGraph.get(imp);
      if (skipExisting && dependents.includes(fileKey)) continue;
      dependents.push(fileKey);
    }
  }

  _removeOldReverseEdges(fileKey) {
    const oldInfo = this.dg.graph.get(fileKey);
    if (!oldInfo) return;
    for (const imp of oldInfo.imports) {
      const dependents = this.dg.reverseGraph.get(imp);
      if (dependents) {
        const filtered = dependents.filter((d) => d !== fileKey);
        if (filtered.length > 0) {
          this.dg.reverseGraph.set(imp, filtered);
        } else {
          this.dg.reverseGraph.delete(imp);
        }
      }
    }
  }

  buildReverseGraph() {
    this.dg.reverseGraph.clear();

    for (const [file, info] of this.dg.graph) {
      this._addReverseEdges(file, info.imports);
    }
  }

  async expandJavaPackageImports() {
    const startTime = Date.now();
    let edgeCount = 0;
    let wildcardCount = 0;
    let samePackageCount = 0;

    // Build package index from all Java/Kotlin files in the graph
    const packageIndex = new Map();
    for (const [fileKey, info] of this.dg.graph) {
      const ext = path.extname(fileKey).toLowerCase();
      if (!['.java', '.kt'].includes(ext)) continue;
      if (!info.package) continue;

      const files = packageIndex.get(info.package) || [];
      files.push(fileKey);
      packageIndex.set(info.package, files);
    }

    if (packageIndex.size === 0) return;

    // Expand wildcard imports and same-package implicit references
    for (const [fileKey, info] of this.dg.graph) {
      const ext = path.extname(fileKey).toLowerCase();
      if (!['.java', '.kt'].includes(ext)) continue;

      // Defensive copy to avoid mutating cached arrays
      if (!info._implicitMutated) {
        info.imports = info.imports.slice();
        info.importRecords = info.importRecords.slice();
        info._implicitMutated = true;
        this.dg.graph.set(fileKey, info);
      }

      // 1. Expand wildcard imports
      for (const record of info.importRecords || []) {
        if (record.usesAllExports && !record.resolved) {
          const pkgName = record.source.replace(/\.\*$/, '');
          const pkgFiles = packageIndex.get(pkgName);
          if (pkgFiles) {
            for (const targetFile of pkgFiles) {
              if (targetFile === fileKey) continue;
              if (!info.imports.includes(targetFile)) {
                info.imports.push(targetFile);
                edgeCount++;
              }
              const hasRecord = info.importRecords.some(
                (r) => r.resolved === targetFile && r.source === record.source
              );
              if (!hasRecord) {
                info.importRecords.push({
                  ...record,
                  resolved: targetFile,
                });
              }
              if (!this.dg.reverseGraph.has(targetFile)) {
                this.dg.reverseGraph.set(targetFile, []);
              }
              const dependents = this.dg.reverseGraph.get(targetFile);
              if (!dependents.includes(fileKey)) {
                dependents.push(fileKey);
              }
            }
            wildcardCount++;
          }
        }
      }

      // 2. Same-package implicit references
      if (info.package) {
        const pkgFiles = packageIndex.get(info.package);
        if (pkgFiles) {
          for (const targetFile of pkgFiles) {
            if (targetFile === fileKey) continue;
            if (!info.imports.includes(targetFile)) {
              info.imports.push(targetFile);
              edgeCount++;
              samePackageCount++;
            }
            const implicitSource = `<same-package:${info.package}>`;
            const hasRecord = info.importRecords.some(
              (r) => r.resolved === targetFile && r.source === implicitSource
            );
            if (!hasRecord) {
              info.importRecords.push(
                buildImplicitImportRecord(implicitSource, targetFile, 'java-same-package')
              );
            }
            if (!this.dg.reverseGraph.has(targetFile)) {
              this.dg.reverseGraph.set(targetFile, []);
            }
            const dependents = this.dg.reverseGraph.get(targetFile);
            if (!dependents.includes(fileKey)) {
              dependents.push(fileKey);
            }
          }
        }
      }
    }

    if (!this.dg.quiet && (wildcardCount > 0 || samePackageCount > 0)) {
      console.error(
        `[DepGraph] Expanded ${wildcardCount} wildcard imports + ${samePackageCount} same-package refs ` +
          `(${edgeCount} edges) in ${Date.now() - startTime}ms`
      );
    }
    if (edgeCount > 0) {
      this.dg._cachedCycles = null;
      this.dg._cycleCount = undefined;
    }
  }

  async applyFrameworkImplicitImports() {
    const startTime = Date.now();
    let implicitEdgeCount = 0;
    let i = 0;

    for (const [fileKey, info] of this.dg.graph) {
      i++;
      // Yield to event loop every 20 files to prevent starvation in large repos
      if (i % 20 === 0) {
        await new Promise((r) => setImmediate(r));
      }

      const ext = path.extname(fileKey).toLowerCase();
      if (!['.js', '.jsx', '.ts', '.tsx', '.vue', '.mjs', '.cjs'].includes(ext)) continue;

      let content;
      try {
        content = await readFile(fileKey, 'utf-8');
      } catch {
        continue;
      }

      const implicitSources = scanAndExtractImplicitImports(fileKey, content);
      if (implicitSources.length === 0) continue;

      const resolved = resolveImplicitImports(fileKey, implicitSources, this.dg.root);
      if (resolved.length === 0) continue;

      // Defensive copy to avoid mutating cached arrays (cache-hit uses shallow clone)
      if (!info._implicitMutated) {
        info.imports = info.imports.slice();
        info.importRecords = info.importRecords.slice();
        info._implicitMutated = true;
        this.dg.graph.set(fileKey, info);
      }

      for (const { source, resolved: resolvedPath, patternId } of resolved) {
        const normalizedResolved = this.dg.normalizeFilePath(resolvedPath);
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

        if (!this.dg.reverseGraph.has(normalizedResolved)) {
          this.dg.reverseGraph.set(normalizedResolved, []);
        }
        const dependents = this.dg.reverseGraph.get(normalizedResolved);
        if (!dependents.includes(fileKey)) {
          dependents.push(fileKey);
          implicitEdgeCount++;
        }
      }
    }

    if (!this.dg.quiet && implicitEdgeCount > 0) {
      console.error(`[DepGraph] Applied ${implicitEdgeCount} framework implicit import edges in ${Date.now() - startTime}ms`);
    }
    // P85: implicit edges mutate the graph — invalidate cycle cache
    this.dg._cachedCycles = null;
    this.dg._cycleCount = undefined;
  }

  async updateFiles(filePaths) {
    if (this.dg._updating) {
      // Reentrancy guard: debounce may trigger overlapping updates
      return;
    }
    this.dg._updating = true;

    const startTime = Date.now();
    let reParsed = 0;
    let skipped = 0;

    try {
      for (const filePath of filePaths) {
      const key = this.dg.normalizeFilePath(filePath);

      // Handle deleted files FIRST — must not be masked by cache-hit fast path
      if (!fs.existsSync(filePath)) {
        this._removeOldReverseEdges(key);

        // P102: Clean incoming edges — remove deleted file from all reverseGraph entries
        for (const [dependentKey, dependents] of this.dg.reverseGraph) {
          const idx = dependents.indexOf(key);
          if (idx >= 0) {
            dependents.splice(idx, 1);
            if (dependents.length === 0) {
              this.dg.reverseGraph.delete(dependentKey);
            }
          }
        }
        // P102: Clean other files' imports / importRecords referencing deleted file
        for (const [, info] of this.dg.graph) {
          const idx = info.imports.indexOf(key);
          if (idx >= 0) {
            info.imports.splice(idx, 1);
            info.importRecords = info.importRecords.filter((r) => r.resolved !== key);
          }
        }
        this.dg.reverseGraph.delete(key);

        this.dg.graph.delete(key);
        this.dg.cache.deleteFileMetadata(filePath);
        this.dg.cache.deleteParseResult(filePath);
        this.dg.cache.clearDiagnostics(filePath);
        this.dg._scanContentCache.delete(key);
        continue;
      }

      // Fast path: file unchanged (graph and cache agree on mtime)
      const oldInfo = this.dg.graph.get(key);
      const meta = this.dg.cache.getFileMetadata(filePath);
      const cached = this.dg.cache.getParseResult(filePath);
      if (oldInfo && cached && meta && cached.mtime === meta.mtime) {
        skipped++;
        continue;
      }

      this._removeOldReverseEdges(key);
      this.dg._scanContentCache.delete(key);

      // Re-parse
      await this.analyzeFile(filePath);
      reParsed++;
      this.dg._cycleCount = undefined;
      this.dg._cachedCycles = null;

      const newInfo = this.dg.graph.get(key);
      if (newInfo) {
        this._addReverseEdges(key, newInfo.imports, { skipExisting: true });
      }
      // P8-1 callback slot
      if (this.onFileUpdated) {
        this.onFileUpdated(filePath);
      }
    }

    // P105: run post-process phases when any file was re-parsed,
    // because re-parsing wipes previous implicit edges from graph.imports.
    if (reParsed > 0) {
      for (const phase of this.postProcessPhases) {
        await phase();
      }
    }

    if (!this.dg.quiet && (reParsed > 0 || skipped > 0)) {
      console.error(`[DepGraph] Incremental update: ${reParsed} re-parsed, ${skipped} skipped in ${Date.now() - startTime}ms`);
    }
    } finally {
      this.dg._updating = false;
    }
  }

}

class GraphAnalyzer {
  constructor(depGraph) {
    this.dg = depGraph;
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

  findCircularDependencies() {
    // P85: return cached filtered cycles so all consumers see the same data.
    if (this.dg._cachedCycles) {
      return this.dg._cachedCycles;
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
    this.dg._cachedCycles = displayFiltered;
    return displayFiltered;
  }

  getStats() {
    // P85: always use the same filtered cycles array that findCircularDependencies()
    // returns, eliminating any stale-cache divergence between the two paths.
    const cycles = this.findCircularDependencies();
    this.dg._cycleCount = cycles.length;
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
      cycles: this.dg._cycleCount,
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
    const patternCache = this.dg._scanPatternCache;

    for (const importerPath of importerPaths) {
      try {
        let content = this.dg._scanContentCache.get(importerPath);
        if (content === undefined) {
          content = fs.readFileSync(importerPath, 'utf-8');
          // Defensive cap: prevent unbounded growth in long-lived REPL sessions
          if (this.dg._scanContentCache.size < LIMITS.SCAN_SYMBOL_CONTENT_CACHE_MAX) {
            this.dg._scanContentCache.set(importerPath, content);
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
      let content = this.dg._scanContentCache.get(filePath);
      if (content === undefined) {
        content = fs.readFileSync(filePath, 'utf-8');
        if (this.dg._scanContentCache.size < LIMITS.SCAN_SYMBOL_CONTENT_CACHE_MAX) {
          this.dg._scanContentCache.set(filePath, content);
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

  findDeadExports() {
    const deadExports = [];

    for (const [filePath, info] of this.dg.graph) {
      if (this.dg.shouldExcludeCli(filePath)) continue;
      if (info.exports.length === 0) continue;
      if (this.dg.isTestLikeFile(filePath)) continue;
      if (this.dg.isKnownEntryFile(filePath, info.exports)) continue;
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
        const { confidence, confidenceValue, source, reason } = computeDeadExportConfidence(0, info.parseMode, graphUnreliable);
        deadExports.push({ file: this.dg._displayPath(filePath), exports: info.exports, confidence, confidenceValue, confidenceSource: source, confidenceReason: reason, importerCount: 0, scaffold });
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

      // L3-1: 扫描模块内部使用（同文件内的函数调用/属性访问），消除 barrel/internal-use 误报
      if (unused.length > 0) {
        const locallyUsed = this._scanLocalSymbolUsage(filePath, unused);
        unused = unused.filter((name) => !locallyUsed.has(name));
      }

      if (unused.length > 0) {
        const isConstantsWarehouse = isLikelyConstantsWarehouse(filePath, info.exportRecords);
        if (isConstantsWarehouse || scaffold) continue;
        const { confidence, confidenceValue, source, reason } = computeDeadExportConfidence(importers.length, info.parseMode, false);
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
        });
      }
    }

    return deadExports;
  }

  findUnresolvedImports() {
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

  findAffectedTests(filePath, maxDepth = CONFIG.DEFAULT_MAX_DEPTH, options = {}) {
    const start = this.dg.normalizeFilePath(filePath);
    const results = this._findAffectedTestsByGraph(start, maxDepth);
    if (options?.includeHeuristic !== false) {
      this._findAffectedTestsByHeuristic(start, maxDepth, results);
    }
    // P89: convert internal graph keys back to original-casing paths for output.
    return results.map((r) => ({
      ...r,
      file: this.dg._displayPath(r.file),
      via: r.via ? r.via.map((f) => this.dg._displayPath(f)) : r.via,
    }));
  }

  getScopeSummary() {
    const files = Array.from(this.dg.cache.fileMetadata.keys()).filter((file) => {
      if (this.dg.shouldExclude(file)) return false;
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

class GraphQuery {
  constructor(depGraph) {
    this.dg = depGraph;
  }

  getDependencies(filePath) {
    return this.dg.getFileInfo(filePath)?.imports || [];
  }

  getDependents(filePath) {
    return this.dg.reverseGraph.get(this.dg.normalizeFilePath(filePath)) || [];
  }

  getImpactRadius(filePath, depth = 3) {
    const start = this.dg.normalizeFilePath(filePath);
    const results = bfsTraverse(start, (file) => {
      // Stop diffusion at entry files: every module eventually converges to
      // cli.js / app.vue / index.js, which provides zero actionable info.
      if (file !== start && this.dg.isKnownEntryFile(file)) return [];
      return this.getDependents(file);
    }, {
      maxDepth: depth,
      onVisit: (file, level, via) => {
        if (level === 0 || file === start) return undefined;
        const currentInfo = this.dg.getFileInfo(file);

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
    // P89: convert internal graph keys back to original-casing paths for output.
    return results.map((r) => ({
      ...r,
      file: this.dg._displayPath(r.file),
      via: r.via ? r.via.map((f) => this.dg._displayPath(f)) : r.via,
    }));
  }
}

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
    if (this.cliExcludeDirs.length === 0) return false;
    const normalized = normalizePathKey(filePath);
    return this.cliExcludeDirs.some((pattern) => {
      // Simple glob support: *.ext, prefix*, ?ingle-char
      if (pattern.includes('*') || pattern.includes('?')) {
        const regex = new RegExp('^' + pattern
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.') + '$');
        return regex.test(path.basename(normalized)) || regex.test(normalized);
      }
      return matchesPathFragment(normalized, pattern);
    });
  }

  normalizeFilePath(filePath) {
    return normalizePathKey(filePath);
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

  getDependencies(...args) {
    return this.query.getDependencies(...args);
  }

  getDependents(...args) {
    return this.query.getDependents(...args);
  }

  getImpactRadius(...args) {
    return this.query.getImpactRadius(...args);
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
};
