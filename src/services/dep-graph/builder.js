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

const readFile = promisify(fs.readFile);
class GraphBuilder {
  constructor(depGraph) {
    this.dg = depGraph;
    this.onBuildComplete = null;
    this.onFileUpdated = null;
    // P105: soft post-process phase architecture
    this.postProcessPhases = [];
    this.postProcessPhases.push({
      fn: () => this.expandJavaPackageImports(),
      triggers: ['.java', '.kt'],
    });
    this.postProcessPhases.push({
      fn: () => this.applyFrameworkImplicitImports(),
      triggers: ['.js', '.jsx', '.ts', '.tsx', '.vue', '.mjs', '.cjs'],
    });
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

    // Refresh resolver FS caches for each build to avoid stale paths
    clearResolverCaches();

    // Reset graph to prevent ghost data from deleted/renamed files
    this.dg.graph.clear();
    this.dg._cycleCount = undefined;
    this.dg._cachedCycles = null;
    this.dg.analyzer._bumpAggregateCache();
    this.dg.analyzer._bumpAggregateCache();
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
      await phase.fn();
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

    // P2: precompute aggregate summaries so subsequent queries are O(1)
    this.dg.analyzer.precomputeAggregates();
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
    this.dg.analyzer._bumpAggregateCache();
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
    this.dg.analyzer._bumpAggregateCache();
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
    const reParsedExts = new Set();

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
      const ext = path.extname(filePath).toLowerCase();
      if (ext) reParsedExts.add(ext);
      this.dg._cycleCount = undefined;
      this.dg._cachedCycles = null;
    this.dg.analyzer._bumpAggregateCache();
      this.dg.analyzer._bumpAggregateCache();

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
    // D5: only run phases whose trigger extensions match re-parsed files.
    if (reParsed > 0) {
      for (const phase of this.postProcessPhases) {
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
      this.dg._updating = false;
      if (this.dg.cache && typeof this.dg.cache.save === 'function') {
        try {
          await this.dg.cache.save();
        } catch (e) {
          if (process.env.DEBUG) {
            console.error('[GraphBuilder] cache.save() failed:', e.message);
          }
        }
      }
    }
  }

}
module.exports = { GraphBuilder };