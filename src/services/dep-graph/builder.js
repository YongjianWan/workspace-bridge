/**
 * GraphBuilder - Dependency Graph Construction & Linking
 * Responsible for the Parse Phase (file scanning and AST/regex extraction) and Link Phase (resolving imports and constructing the graph).
 */
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { createImportRecord } = require('./parsers');
const { registry } = require('./parsers/registry');
const { resolveImport, clearResolverCaches } = require('./resolvers');
const { detectFrameworkFromPath, detectFrameworkFromContent } = require('./framework-patterns');
const {
  scanAndExtractImplicitImports,
  resolveImplicitImports,
  buildImplicitImportRecord,
} = require('./implicit-imports');
const { CONFIG } = require('./shared');
const { SymbolRegistry } = require('./symbol-registry');
const { shadowCandidatesFor } = require('./shadow-candidates');
const { WalCadence } = require('./wal-cadence');

const readFile = promisify(fs.readFile);
const YIELD_INTERVAL = 20; // event loop yield frequency for large repos
class GraphBuilder {
  constructor(depGraph) {
    this.dg = depGraph;
    this.onBuildComplete = null;
    this.onFileUpdated = null;
    this.symbolRegistry = new SymbolRegistry();
    // P105: soft post-process phase architecture
    this.postProcessPhases = [];
    this.postProcessPhases.push({
      id: 'expand-java-packages',
      fn: () => this.expandJavaPackageImports(),
      triggers: ['.java', '.kt'],
    });
    this._parseCache = new Map();
    this._walCadence = new WalCadence();
  }

  registerPostProcessPhase(phase) {
    if (typeof phase === 'function') {
      this.postProcessPhases.push({ fn: phase });
    } else if (phase && typeof phase.fn === 'function') {
      this.postProcessPhases.push(phase);
    } else {
      throw new TypeError('registerPostProcessPhase expects a function or { fn: () => void, triggers?: string[] }');
    }
  }

  async build(sourceFiles = null) {
    const startTime = Date.now();

    // O6: lifecycle — reset then start building so repeated builds work
    // regardless of current state (IDLE, READY, ERROR).
    this.dg._resetState();
    this.dg._startBuilding();

    // Refresh resolver FS caches for each build to avoid stale paths
    clearResolverCaches();

    // Reset graph to prevent ghost data from deleted/renamed files
    this.dg.graph.clear();
    this.dg.bus.emit('graph:updated', { fullRebuild: true });
    // Clear per-build caches to avoid stale content after rebuild
    this.dg._scanContentCache.clear();
    this.dg._scanPatternCache.clear();
    this._parseCache.clear();

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
    
    // Decoupled Phase 1: Parse Phase (Extract symbols and imports)
    const parsedList = await this._parseFilesWithLimit(filesToAnalyze, CONFIG.DEFAULT_CONCURRENCY);
    
    for (const parsed of parsedList) {
      this.dg.graph.set(parsed.graphKey, {
        originalPath: parsed.filePath,
        imports: [],
        exports: parsed.exports,
        importRecords: [],
        exportRecords: parsed.exportRecords,
        functionRecords: parsed.functionRecords,
        parseMode: parsed.parseMode,
        parseModeReason: parsed.parseModeReason,
        confidence: parsed.confidence,
        package: parsed.package,
        frameworkHint: parsed.frameworkHint || null,
      });
    }

    // Build the global symbol registry with cached files + newly parsed files' exports
    this._buildSymbolRegistry();

    // Decoupled Phase 2: Link/Resolve Phase (Resolve imports using completed symbol registry)
    for (const parsed of parsedList) {
      try {
        this.resolveFileOnly(parsed);
      } catch (e) {
        this._markParseError(parsed.graphKey, parsed.filePath, `[DepGraph] Failed to resolve imports for ${parsed.filePath}: ${e?.message || e}`);
      }
    }

    // P105: run post-process phases (framework implicit imports, etc.)
    for (const phase of this.postProcessPhases) {
      await phase.fn();
    }

    // Filter out non-value imports (type-only, interface, annotation, lazy/dynamic)
    this._filterNonValueImports();

    // Build reverse graph
    this.buildReverseGraph();

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

    // Wave 1: build global symbol registry from exportRecords
    this._buildSymbolRegistry();

    // D1-D2: persist edges to SQLite for fast loadGraph() on next startup
    await this._saveEdges();

    // O6: mark graph ready so that listeners can query safely
    this.dg._finishBuilding();

    // O4: Builder no longer knows Analyzer. Post-build analysis is triggered
    // by the 'graph:built' event, which the facade (DependencyGraph) listens
    // to and coordinates precompute + persistence.
    await this.dg.bus.emitAsync('graph:built');
  }

  async _processFilesWithLimit(files, limit) {
    const executing = new Set();

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const promise = this.analyzeFile(file)
        .catch(() => undefined)          // Wave 5 #16: swallow any rejection
        .finally(() => executing.delete(promise));
      executing.add(promise);

      if (executing.size >= limit) {
        await Promise.race(executing);
      }
      // Yield to event loop every 20 files to prevent starvation in large repos
      if ((i + 1) % YIELD_INTERVAL === 0) {
        await new Promise((r) => setImmediate(r));
      }
    }

    await Promise.all(executing);
  }

  async _parseFilesWithLimit(files, limit) {
    const executing = new Set();
    const results = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const promise = this.parseFileOnly(file)
        .then((res) => {
          if (res) results.push(res);
        })
        .catch(() => undefined)
        .finally(() => executing.delete(promise));
      executing.add(promise);

      if (executing.size >= limit) {
        await Promise.race(executing);
      }
      if ((i + 1) % YIELD_INTERVAL === 0) {
        await new Promise((r) => setImmediate(r));
      }
    }

    await Promise.all(executing);
    return results;
  }

  async parseFileOnly(filePath, contentOverride = null) {
    const graphKey = this.dg.normalizeFilePath(filePath);
    const meta = this.dg.cache ? this.dg.cache.getFileMetadata(filePath) : null;
    const cached = this._parseCache.get(graphKey);
    if (cached && meta && cached.mtime === meta.mtime) {
      return cached.result;
    }

    const content = contentOverride !== null ? contentOverride : await readFile(filePath, 'utf8');
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
      const result = entry.async ? await entry.parse(...args) : entry.parse(...args);
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

    const frameworkHint = await detectFrameworkFromContent(filePath, content);

    const parsed = {
      filePath,
      graphKey,
      content,
      imports,
      exports,
      importRecords,
      exportRecords,
      functionRecords,
      parseMode,
      parseModeReason,
      confidence: parseMode === 'ast' ? 'high' : 'medium',
      package: packageName,
      frameworkHint,
    };

    if (meta) {
      this._parseCache.set(graphKey, { mtime: meta.mtime, result: parsed });
      if (this._parseCache.size > 200) {
        const oldest = this._parseCache.keys().next().value;
        this._parseCache.delete(oldest);
      }
    }

    return parsed;
  }

  resolveFileOnly(parsed) {
    const { filePath, graphKey, content, imports, exports, importRecords, exportRecords, functionRecords, parseMode, parseModeReason, confidence, package: packageName } = parsed;
    const ext = path.extname(filePath);

    // Resolve relative/absolute/symbol imports to absolute paths
    const resolvedImportRecords = (importRecords.length > 0 ? importRecords : imports.map((source) => createImportRecord(source)))
      .map((record) => {
        const outMeta = {};
        const resolved = resolveImport(filePath, record.source, ext, this.dg.root, this.symbolRegistry, outMeta);
        if (!resolved) {
          // Keep wildcard imports even if they don't resolve directly to a file
          if (record.usesAllExports && record.source.endsWith('.*')) {
            return record;
          }
          return null;
        }
        return {
          ...record,
          resolved: this.dg.normalizeFilePath(resolved),
          tier: outMeta.tier || 'tier1',
          resolutionMethod: outMeta.method || 'import',
          confidence: outMeta.confidence ?? 1.0,
        };
      })
      .filter(Boolean);

    // Down-shift framework implicit dependencies scan
    const implicitExts = ['.js', '.jsx', '.ts', '.tsx', '.vue', '.mjs', '.cjs'];
    if (implicitExts.includes(ext.toLowerCase())) {
      const implicitSources = scanAndExtractImplicitImports(filePath, content);
      if (implicitSources.length > 0) {
        const resolvedImps = resolveImplicitImports(filePath, implicitSources, this.dg.root);
        for (const { source, resolved: resolvedPath, patternId } of resolvedImps) {
          const normalizedResolved = this.dg.normalizeFilePath(resolvedPath);
          if (normalizedResolved === graphKey) continue;

          const hasRecord = resolvedImportRecords.some(
            (r) => r.resolved === normalizedResolved && r.source === source
          );
          if (!hasRecord) {
            const rec = buildImplicitImportRecord(source, normalizedResolved, patternId);
            rec.tier = 'tier1';
            rec.resolutionMethod = 'implicit-framework';
            rec.confidence = 1.0;
            resolvedImportRecords.push(rec);
          }
        }
      }
    }

    const resolvedImports = resolvedImportRecords.map((record) => record.resolved).filter((imp) => imp && imp !== graphKey);

    this.dg.graph.set(graphKey, {
      originalPath: filePath,
      imports: resolvedImports,
      exports,
      importRecords: resolvedImportRecords,
      exportRecords,
      functionRecords: functionRecords.length > 0 ? functionRecords : [],
      parseMode,
      parseModeReason,
      confidence,
      package: packageName,
      frameworkHint: parsed.frameworkHint || null,
    });

    // Cache parse result for incremental rebuilds
    const meta = this.dg.cache.getFileMetadata(filePath);
    if (meta) {
      this.dg.cache.setParseResult(filePath, {
        ...this.dg.graph.get(graphKey),
        mtime: meta.mtime,
      });
    }
  }

  async analyzeFile(filePath) {
    try {
      const parsed = await this.parseFileOnly(filePath);
      this.resolveFileOnly(parsed);
    } catch (e) {
      this._markParseError(this.dg.normalizeFilePath(filePath), filePath, `[DepGraph] Failed to analyze ${filePath}: ${e?.message || e}`);
    }
  }

  _markParseError(fileKey, filePath, errorMsg) {
    console.error(errorMsg);
    this.dg.graph.delete(fileKey);
    this.dg.cache.deleteParseResult(filePath);
    if (!this.dg._parseErrorFiles) this.dg._parseErrorFiles = new Set();
    this.dg._parseErrorFiles.add(fileKey);
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

  _serializeEdges() {
    const edges = [];
    for (const [file, info] of this.dg.graph) {
      for (const imp of info.imports || []) {
        const record = info.importRecords?.find((r) => r.resolved === imp);
        edges.push({
          source: file,
          target: imp,
          edgeType: 'import',
          confidence: record ? (record.confidence ?? 1.0) : 1.0,
          tier: record ? (record.tier || 'tier1') : 'tier1',
          resolutionMethod: record ? (record.resolutionMethod || 'import') : 'import',
        });
      }
    }
    return edges;
  }

  async _saveEdges() {
    if (!this.dg.cache || typeof this.dg.cache.saveEdges !== 'function') return;
    try {
      const edges = this._serializeEdges();
      this.dg.cache.saveEdges(edges);
    } catch (e) {
      if (process.env.DEBUG) {
        console.error('[GraphBuilder] saveEdges failed:', e.message);
      }
    }
  }

  _buildPackageIndex() {
    this.packageIndex = new Map();
    for (const [fileKey, info] of this.dg.graph) {
      const ext = path.extname(fileKey).toLowerCase();
      if (!['.java', '.kt'].includes(ext)) continue;
      if (!info.package) continue;

      if (!this.packageIndex.has(info.package)) {
        this.packageIndex.set(info.package, new Set());
      }
      this.packageIndex.get(info.package).add(fileKey);
    }
  }

  _stripJavaExpansions(info) {
    if (!info || !info.importRecords) return;
    const toRemove = new Set();
    info.importRecords = info.importRecords.filter((r) => {
      // 1. Same-package implicit records
      if (r.isImplicit && r.patternId === 'java-same-package') {
        toRemove.add(r.resolved);
        return false;
      }
      // 2. Wildcard expanded records (they have a wildcard source and a resolved target)
      if (r.usesAllExports && r.source.endsWith('.*') && r.resolved) {
        toRemove.add(r.resolved);
        return false;
      }
      return true;
    });
    // Remove from imports array
    if (toRemove.size > 0 && info.imports) {
      info.imports = info.imports.filter((imp) => !toRemove.has(imp));
    }
  }

  _expandJavaForFile(fileKey, info) {
    let edgeCount = 0;
    let wildcardCount = 0;
    let samePackageCount = 0;

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
        const pkgFiles = this.packageIndex.get(pkgName);
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
                tier: 'tier1',
                resolutionMethod: 'java-wildcard',
                confidence: 1.0,
              });
            }
          }
          wildcardCount++;
        }
      }
    }

    // 2. Same-package implicit references
    if (info.package) {
      const pkgFiles = this.packageIndex.get(info.package);
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
            const rec = buildImplicitImportRecord(implicitSource, targetFile, 'java-same-package');
            rec.tier = 'tier1';
            rec.resolutionMethod = 'java-same-package';
            rec.confidence = 1.0;
            info.importRecords.push(rec);
          }
        }
      }
    }

    return { edgeCount, wildcardCount, samePackageCount };
  }

  async expandJavaPackageImports() {
    const startTime = Date.now();
    this._buildPackageIndex();
    if (this.packageIndex.size === 0) return;

    let edgeCount = 0;
    let wildcardCount = 0;
    let samePackageCount = 0;

    for (const [fileKey, info] of this.dg.graph) {
      const ext = path.extname(fileKey).toLowerCase();
      if (!['.java', '.kt'].includes(ext)) continue;

      this._removeOldReverseEdges(fileKey);
      this._stripJavaExpansions(info);

      const expanded = this._expandJavaForFile(fileKey, info);
      this._addReverseEdges(fileKey, info.imports, { skipExisting: true });

      edgeCount += expanded.edgeCount;
      wildcardCount += expanded.wildcardCount;
      samePackageCount += expanded.samePackageCount;
    }

    if (!this.dg.quiet && (wildcardCount > 0 || samePackageCount > 0)) {
      console.error(
        `[DepGraph] Expanded ${wildcardCount} wildcard imports + ${samePackageCount} same-package refs ` +
          `(${edgeCount} edges) in ${Date.now() - startTime}ms`
      );
    }
    // Emit graph:updated whenever the graph structure may have changed,
    // even if edgeCount is 0 (edges may have been removed by _stripJavaExpansions).
    this.dg.bus.emit('graph:updated', {});
  }

  async expandJavaPackageImportsIncremental(affectedFiles) {
    if (!affectedFiles || affectedFiles.size === 0) return;
    this._buildPackageIndex();

    let edgeCount = 0;
    let wildcardCount = 0;
    let samePackageCount = 0;

    for (const fileKey of affectedFiles) {
      const info = this.dg.graph.get(fileKey);
      if (!info) continue;

      // 1. Remove old reverse edges for this file key
      this._removeOldReverseEdges(fileKey);

      // 2. Strip Java expansions from this file
      this._stripJavaExpansions(info);

      // 3. Expand Java package imports for this file
      const expanded = this._expandJavaForFile(fileKey, info);
      edgeCount += expanded.edgeCount;
      wildcardCount += expanded.wildcardCount;
      samePackageCount += expanded.samePackageCount;

      // 4. Add back reverse edges with the newly expanded imports
      this._addReverseEdges(fileKey, info.imports, { skipExisting: true });
    }

    if (!this.dg.quiet && (wildcardCount > 0 || samePackageCount > 0)) {
      console.error(
        `[DepGraph] Incremental expanded ${wildcardCount} wildcard imports + ${samePackageCount} same-package refs ` +
          `(${edgeCount} edges) for ${affectedFiles.size} affected files`
      );
    }
    // Defensive: emit even when edgeCount is 0, because _stripJavaExpansions
    // may have removed edges without adding new ones.
    this.dg.bus.emit('graph:updated', { changedFiles: Array.from(affectedFiles) });
  }

  async updateFiles(filePaths) {
    if (this.dg._updating) {
      // Reentrancy guard: debounce may trigger overlapping updates
      return;
    }
    this.dg._startUpdating();

    // Refresh resolver FS caches for incremental updates to avoid stale paths
    clearResolverCaches();

    const startTime = Date.now();
    let reParsed = 0;
    let skipped = 0;
    const reParsedExts = new Set();
    const parsedList = [];

    const oldInfos = new Map();
    const deletedKeys = [];
    const updatedKeys = [];

    // Pre-record old info keys/packages to calculate affected sets.
    // NOTE: shallow copy; we only consume .package from oldInfos, so shared
    // imports/importRecords references are safe for current usage.
    for (const filePath of filePaths) {
      const key = this.dg.normalizeFilePath(filePath);
      const oldInfo = this.dg.graph.get(key);
      if (oldInfo) {
        oldInfos.set(key, { ...oldInfo });
      }
    }

    try {
      const changedKeys = new Set();
      const toEvictCache = new Set();
      const physicalChanges = [];

      for (const filePath of filePaths) {
        const key = this.dg.normalizeFilePath(filePath);
        changedKeys.add(key);
        if (!fs.existsSync(filePath)) {
          deletedKeys.push(key);
        } else {
          physicalChanges.push(filePath);
          toEvictCache.add(key);
        }
      }

      // L3: Neighbor-aware 1-hop 扩展 & Shadow Candidates
      const dependentsKeys = new Set();
      for (const key of changedKeys) {
        // 1. 1-hop dependents
        const deps = this.dg.reverseGraph.get(key) || [];
        for (const dep of deps) {
          if (!changedKeys.has(dep)) {
            dependentsKeys.add(dep);
          }
        }

        // 2. Shadow Candidates
        const oldInfo = this.dg.graph.get(key);
        if (!oldInfo) {
          // It's a new file. Get original path and calculate shadow candidates.
          const originalPath = filePaths.find(p => this.dg.normalizeFilePath(p) === key);
          if (originalPath && fs.existsSync(originalPath)) {
            const candidates = shadowCandidatesFor(originalPath);
            for (const cand of candidates) {
              const candKey = this.dg.normalizeFilePath(cand);
              const candDeps = this.dg.reverseGraph.get(candKey) || [];
              for (const dep of candDeps) {
                if (!changedKeys.has(dep)) {
                  dependentsKeys.add(dep);
                }
              }
            }
          }
        }
      }

      const dependentsPaths = [];
      for (const key of dependentsKeys) {
        const info = this.dg.graph.get(key);
        if (info && info.originalPath && fs.existsSync(info.originalPath)) {
          dependentsPaths.push(info.originalPath);
        }
      }

      // Evict parse cache for physically changed files
      for (const key of toEvictCache) {
        this._parseCache.delete(key);
      }

      // Handle deleted files FIRST — must not be masked by cache-hit fast path
      for (const key of deletedKeys) {
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
        this._parseCache.delete(key);
        const originalPath = filePaths.find(p => this.dg.normalizeFilePath(p) === key) || key;
        if (this.dg.cache) {
          this.dg.cache.deleteFileMetadata(originalPath);
          this.dg.cache.deleteParseResult(originalPath);
          this.dg.cache.clearDiagnostics(originalPath);
        }
        this.dg.bus.emit('graph:updated', { changedFiles: [key] });
      }

      // Process physical changes and dependents
      const loopItems = [
        ...physicalChanges.map(p => ({ filePath: p, isDependentOnly: false })),
        ...dependentsPaths.map(p => ({ filePath: p, isDependentOnly: true })),
      ];

      for (const item of loopItems) {
        const { filePath, isDependentOnly } = item;
        const key = this.dg.normalizeFilePath(filePath);

        if (isDependentOnly) {
          this._removeOldReverseEdges(key);
          try {
            const parsed = await this.parseFileOnly(filePath);
            if (parsed) {
              parsedList.push(parsed);
            }
          } catch (e) {
            console.error(`[DepGraph] Failed to parse neighbor ${filePath}:`, e?.message || e);
          }
        } else {
          // Fast path: file unchanged (graph and cache agree on mtime)
          const oldInfo = this.dg.graph.get(key);
          const meta = this.dg.cache ? this.dg.cache.getFileMetadata(filePath) : null;
          const cached = this.dg.cache ? this.dg.cache.getParseResult(filePath) : null;
          if (oldInfo && cached && meta && cached.mtime === meta.mtime) {
            skipped++;
            continue;
          }

          // L2: SHA-256 哈希二次校验 (排除 mtime 伪阳性)
          let content = null;
          const parsedHash = this.dg.cache ? this.dg.cache.parsedHashes?.get(key) : null;
          if (oldInfo && cached && parsedHash) {
            const crypto = require('crypto');
            try {
              content = await readFile(filePath, 'utf8');
              const currentHash = crypto.createHash('sha256').update(content).digest('hex');
              if (currentHash === parsedHash) {
                // Update cached mtime to avoid SHA-256 check next time
                cached.mtime = meta?.mtime || cached.mtime;
                this.dg.cache.setParseResult(filePath, cached);
                skipped++;
                continue;
              }
            } catch (err) {
              // Read failure will be caught or re-read in parseFileOnly
            }
          }

          this._removeOldReverseEdges(key);

          // Re-parse (Parse Phase)
          try {
            const parsed = await this.parseFileOnly(filePath, content);
            if (parsed) {
              parsedList.push(parsed);
              // Temporarily set in graph for symbol registry building
              this.dg.graph.set(parsed.graphKey, {
                originalPath: parsed.filePath,
                imports: [],
                exports: parsed.exports,
                importRecords: [],
                exportRecords: parsed.exportRecords,
                functionRecords: parsed.functionRecords,
                parseMode: parsed.parseMode,
                parseModeReason: parsed.parseModeReason,
                confidence: parsed.confidence,
                package: parsed.package,
                frameworkHint: parsed.frameworkHint || null,
              });
            }
          } catch (e) {
            console.error(`[DepGraph] Failed to parse ${filePath}:`, e?.message || e);
            this.dg.graph.delete(key);
            if (this.dg.cache) {
              this.dg.cache.deleteParseResult(filePath);
            }
            if (!this.dg._parseErrorFiles) this.dg._parseErrorFiles = new Set();
            this.dg._parseErrorFiles.add(key);
          }
        }
      }

      // Re-build symbol registry with the newly parsed exports in graph
      this._buildSymbolRegistry();

      // Link/Resolve Phase
      for (const parsed of parsedList) {
        try {
          this.resolveFileOnly(parsed);
          reParsed++;
          updatedKeys.push(parsed.graphKey);
          const ext = path.extname(parsed.filePath).toLowerCase();
          if (ext) reParsedExts.add(ext);
          this.dg.bus.emit('graph:updated', { changedFiles: [parsed.graphKey] });

          const newInfo = this.dg.graph.get(parsed.graphKey);
          if (newInfo) {
            this._addReverseEdges(parsed.graphKey, newInfo.imports, { skipExisting: true });
          }
          if (this.onFileUpdated) {
            this.onFileUpdated(parsed.filePath);
          }
        } catch (e) {
          this._markParseError(parsed.graphKey, parsed.filePath, `[DepGraph] Failed to resolve ${parsed.filePath}: ${e?.message || e}`);
        }
      }

      // Affected-only incremental Java package expansion
      const affectedJavaFiles = new Set();
      const affectedPackages = new Set();

      // Track old packages of deleted/updated files
      for (const key of deletedKeys) {
        const oldInfo = oldInfos.get(key);
        if (oldInfo && oldInfo.package) {
          affectedPackages.add(oldInfo.package);
        }
        const ext = path.extname(key).toLowerCase();
        if (['.java', '.kt'].includes(ext)) {
          affectedJavaFiles.add(key);
        }
      }
      for (const key of updatedKeys) {
        const oldInfo = oldInfos.get(key);
        if (oldInfo && oldInfo.package) {
          affectedPackages.add(oldInfo.package);
        }
      }

      // Track new packages of updated files
      for (const key of updatedKeys) {
        const newInfo = this.dg.graph.get(key);
        if (newInfo && newInfo.package) {
          affectedPackages.add(newInfo.package);
        }
        const ext = path.extname(key).toLowerCase();
        if (['.java', '.kt'].includes(ext)) {
          affectedJavaFiles.add(key);
        }
      }

      // Find any other Java/Kotlin files in the graph that:
      // - belong to an affected package, OR
      // - have a wildcard import of an affected package
      if (affectedPackages.size > 0) {
        for (const [fileKey, info] of this.dg.graph) {
          const ext = path.extname(fileKey).toLowerCase();
          if (!['.java', '.kt'].includes(ext)) continue;

          if (info.package && affectedPackages.has(info.package)) {
            affectedJavaFiles.add(fileKey);
            continue;
          }

          for (const record of info.importRecords || []) {
            if (record.usesAllExports && record.source.endsWith('.*')) {
              const pkgName = record.source.replace(/\.\*$/, '');
              if (affectedPackages.has(pkgName)) {
                affectedJavaFiles.add(fileKey);
                break;
              }
            }
          }
        }
      }

      if (affectedJavaFiles.size > 0) {
        await this.expandJavaPackageImportsIncremental(affectedJavaFiles);
      }

      // Fallback for custom registered post-process phases (if any)
      if (reParsed > 0) {
        for (const phase of this.postProcessPhases) {
          if (phase.id === 'expand-java-packages') continue;
          if (!phase.triggers) {
            await phase.fn();
          } else {
            const shouldRun = phase.triggers.some((t) => reParsedExts.has(t));
            if (shouldRun) await phase.fn();
          }
        }
      }

      if (!this.dg.quiet && (reParsed > 0 || skipped > 0)) {
        console.error(`[DepGraph] Incremental update: ${reParsed} re-parsed, ${skipped} skipped in ${Date.now() - startTime}ms`);
      }
    } finally {
      this.dg._finishUpdating();

      // Filter out non-value imports (type-only, interface, annotation, lazy/dynamic)
      this._filterNonValueImports();

      // Rebuild reverse graph
      this.buildReverseGraph();

      if (this.dg.cache && typeof this.dg.cache.save === 'function') {
        try {
          await this.dg.cache.save();
          if (typeof this.dg.cache.walCheckpoint === 'function') {
            const mode = this._walCadence.tick();
            this.dg.cache.walCheckpoint(mode);
          }
        } catch (e) {
          if (process.env.DEBUG) {
            console.error('[GraphBuilder] cache.save() failed:', e.message);
          }
        }
      }
      // D1-D2: persist edges after incremental update
      await this._saveEdges();

      // Wave 1: rebuild symbol registry for changed files
      this._buildSymbolRegistry();

      // O4: post-build analysis triggered via event, not direct call.
      await this.dg.bus.emitAsync('graph:built');
    }
  }

  /**
   * Wave 1: Build global symbol registry from all exportRecords in the graph.
   */
  _buildSymbolRegistry() {
    this.symbolRegistry.clear();
    for (const [filePath, info] of this.dg.graph) {
      if (info.exportRecords && info.exportRecords.length > 0) {
        this.symbolRegistry.register(filePath, info.exportRecords);
      }
    }
  }

  _filterNonValueImports() {
    for (const [fileKey, info] of this.dg.graph) {
      if (!info.imports || info.imports.length === 0) continue;

      const filteredImports = [];
      for (const imp of info.imports) {
        // Find matching importRecord
        const record = info.importRecords?.find((r) => r.resolved === imp);
        if (record) {
          // Rule 2: Skip if import is explicitly type-only
          if (record.importKind === 'type' || record.isTypeOnly) {
            continue;
          }

          // Rule 3: Skip if the target file only exports types/interfaces/annotations
          const targetInfo = this.dg.graph.get(imp);
          if (targetInfo) {
            const hasExports = targetInfo.exportRecords && targetInfo.exportRecords.length > 0;
            const allTypeOrInterface = hasExports && targetInfo.exportRecords.every(
              (r) => r.kind === 'interface' || r.kind === 'type' || r.kind === 'annotation'
            );
            if (allTypeOrInterface) {
              continue;
            }

            // Check if all imported symbols in this record are types/interfaces/annotations
            if (record.imported && record.imported.length > 0) {
              const allImportedAreTypes = record.imported.every((sym) => {
                const matchedExport = targetInfo.exportRecords?.find((exp) => exp.name === sym);
                return matchedExport && (
                  matchedExport.kind === 'interface' ||
                  matchedExport.kind === 'type' ||
                  matchedExport.kind === 'annotation'
                );
              });
              if (allImportedAreTypes) {
                continue;
              }
            }
          }
        }

        const sourcePathLower = fileKey.toLowerCase();
        const targetPathLower = imp.toLowerCase();
        const extSource = path.extname(fileKey).toLowerCase();
        const extTarget = path.extname(imp).toLowerCase();
        const isJavaFamily = ['.java', '.kt'].includes(extSource) || ['.java', '.kt'].includes(extTarget);

        if (isJavaFamily) {
          // Rule 5: Stateless Utility Coupling
          // If both files are stateless utility/helper files, prune the edge between them.
          const isSourceUtil = /\/(utils|util|common|core|helper|helpers|tools)\//.test(sourcePathLower) ||
            /(?:utils|formatter|serializer|helper|constants)\./i.test(sourcePathLower);
          const isTargetUtil = /\/(utils|util|common|core|helper|helpers|tools)\//.test(targetPathLower) ||
            /(?:utils|formatter|serializer|helper|constants)\./i.test(targetPathLower);

          if (isSourceUtil && isTargetUtil) {
            continue;
          }

          // Rule 6: Utility to Data Structure/Entity reference
          // Utilities should reference logic/services, but reference to a pure data structure (domain, model, entity, POJO, DTO, VO)
          // is a type/data reference. Prune utility-to-entity edge.
          const isTargetEntity = /\/(domain|model|entity|po|vo|dto|bo)\//.test(targetPathLower);
          if (isSourceUtil && isTargetEntity) {
            continue;
          }
        }

        filteredImports.push(imp);
      }
      info.imports = filteredImports;
    }
  }

}
module.exports = { GraphBuilder };