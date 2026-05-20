/**
 * FileIndex - Unified file indexing with incremental updates
 * Merges SymbolIndex + ContextEngine logic
 * OPTIMIZED: Async indexing with concurrency limit for large repos
 */
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { detectWorkspace, normalizePathKey, matchesPathFragment } = require('../utils/path');
const { loadWorkspaceConfig } = require('../utils/project-context');
const { extractSymbols } = require('./file-index/symbol-extractors');
const { registry } = require('./dep-graph/parsers/registry');
const { DEFAULTS } = require('../config/constants');

const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const readFile = promisify(fs.readFile);

// Limit concurrent file operations to prevent memory exhaustion
const DEFAULT_CONCURRENCY = 50;
const DEFAULT_EXCLUDE_DIRS = ['node_modules', '__pycache__', '.venv', 'venv', '.git', 'dist', 'build', 'target', 'bin', 'obj', '.next', '.nuxt', '.svelte-kit', 'out', '.turbo', 'coverage', '.cache', '.idea', '.vscode', 'vendor'];

class FileIndex {
  constructor(workspaceRoot, cache, options = {}) {
    this.active = true;
    this.root = workspaceRoot;
    this.cache = cache;
    this.workspace = detectWorkspace(workspaceRoot);
    this.projectContext = options.projectContext || null;
    this.watchers = [];
    this.pendingUpdates = new Set();
    this.updateTimer = null;
    this.concurrency = options.concurrency || DEFAULT_CONCURRENCY;
    this.indexedCount = 0;
    this.cliExcludeDirs = [...new Set((options.excludeDirs || []).map((d) => d.trim()).filter(Boolean))];
    this.baseExcludeDirs = [...new Set([...DEFAULT_EXCLUDE_DIRS])];
    this.excludeDirs = [...new Set([...this.baseExcludeDirs, ...this.cliExcludeDirs])];
    this.quiet = options.quiet || false;
  }

  /**
   * Initial build: index all relevant files
   */
  async build(timeoutMs = DEFAULTS.FILE_INDEX_BUILD_TIMEOUT_MS, options = {}) {
    const startTime = Date.now();
    this.indexedCount = 0;
    this.processedCount = 0;
    const shouldWatch = options.watch !== false;
    if (Array.isArray(options.excludeDirs)) {
      this.cliExcludeDirs = [...new Set(options.excludeDirs.map((d) => d.trim()).filter(Boolean))];
      this.baseExcludeDirs = [...new Set([...DEFAULT_EXCLUDE_DIRS])];
      this.excludeDirs = [...new Set([...this.baseExcludeDirs, ...this.cliExcludeDirs])];
    }
    this._applyWorkspaceExcludeDirs();
    const patterns = this.getFilePatterns();

    this.pruneExcludedCacheEntries();

    const controller = new AbortController();
    const allFiles = [];

    // Phase 1: discover all files across patterns
    for (const pattern of patterns) {
      if (Date.now() - startTime > timeoutMs) {
        console.error(`[FileIndex] Build timed out after ${Date.now() - startTime}ms`);
        controller.abort();
        break;
      }
      if (controller.signal.aborted) break;

      const ext = pattern.replace('**/*', '');
      try {
        for await (const file of this.findFilesAsync(this.root, ext, DEFAULTS.FILE_INDEX_MAX_DEPTH, controller.signal)) {
          allFiles.push(file);
        }
      } catch (e) {
        if (controller.signal.aborted) {
          console.error(`[FileIndex] Build timed out after ${Date.now() - startTime}ms`);
        } else {
          throw e;
        }
      }
    }

    // Phase 2: process with progress
    if (!this.quiet && allFiles.length > 0) {
      console.error(`[FileIndex] Discovered ${allFiles.length} files to index`);
    }
    if (allFiles.length > 0) {
      await this.processFilesWithLimit(allFiles, this.concurrency, controller.signal);
    }

    // Remove cache entries for files deleted since last build
    await this.pruneDeletedCacheEntries();

    // CLI mode does not need long-lived watchers.
    if (shouldWatch) {
      this.startWatching();
    }

    if (!this.quiet) {
      const totalFiles = this.getStats().files;
      console.error(`[FileIndex] Built in ${Date.now() - startTime}ms, ${totalFiles} files indexed`);
    }

    // Store the raw discovered file list so dep-graph can use platform-native
    // paths as originalPath instead of normalised cache keys.
    this._indexedFiles = allFiles;
  }

  getFilePatterns() {
    return registry.getFilePatterns(this.workspace);
  }

  /**
   * Index files by pattern with async iteration and concurrency control
   * Includes timeout protection for large repositories
   */
  async indexByPattern(pattern, maxDepth = DEFAULTS.FILE_INDEX_MAX_DEPTH, timeoutMs = DEFAULTS.FILE_INDEX_PATTERN_TIMEOUT_MS) {
    const ext = pattern.replace('**/*', '');
    const files = [];
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      for await (const file of this.findFilesAsync(this.root, ext, maxDepth, controller.signal)) {
        files.push(file);
      }
      if (!controller.signal.aborted) {
        await this.processFilesWithLimit(files, this.concurrency, controller.signal);
      }
    } catch (e) {
      if (controller.signal.aborted) {
        console.error(`[FileIndex] Pattern ${pattern} timed out, indexed ${files.length} files`);
      } else {
        throw e;
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Async generator for finding files (non-blocking for large repos)
   */
  async* findFilesAsync(dir, ext, maxDepth, signal) {
    const queue = [{ path: dir, depth: 0 }];

    while (queue.length > 0) {
      if (signal?.aborted) return;
      const { path: current, depth } = queue.shift();

      if (depth > maxDepth) continue;
      
      let entries;
      try {
        entries = await readdir(current, { withFileTypes: true });
      } catch (e) {
        // Directory read failed (permissions or deleted), skip
        if (process.env.DEBUG) {
          console.error(`[FileIndex] Cannot read directory ${current}: ${e.message}`);
        }
        continue;
      }
      
      // Process entries in batches to allow event loop to breathe
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const fullPath = path.join(current, entry.name);
        
        if (entry.isDirectory()) {
          if (this.shouldExclude(fullPath)) continue;
          queue.push({ path: fullPath, depth: depth + 1 });
        } else if (!this.shouldExclude(fullPath) && fullPath.endsWith(ext)) {
          yield fullPath;
        }
        
        // Yield to event loop every N entries to prevent blocking
        if (i % DEFAULTS.FILE_INDEX_PROGRESS_BATCH === 0) {
          await new Promise(resolve => setImmediate(resolve));
        }
      }
    }
  }

  /**
   * Process files with concurrency limit
   */
  async processFilesWithLimit(files, limit, signal) {
    const executing = new Set();
    const total = files.length;

    for (const file of files) {
      if (signal?.aborted) break;
      const promise = this.processFile(file).finally(() => {
        executing.delete(promise);
        this.processedCount++;
        if (!this.quiet && total > 0 && this.processedCount % DEFAULTS.FILE_INDEX_PROGRESS_BATCH === 0) {
          console.error(`[FileIndex] ${this.processedCount}/${total} indexed...`);
        }
      });
      executing.add(promise);

      if (executing.size >= limit) {
        await Promise.race(executing);
      }
    }

    await Promise.all(executing);
  }

  /**
   * Process a single file (check cache, index if needed)
   */
  async processFile(file) {
    // Skip if cache has fresh data
    const cached = this.cache.getFileMetadata(file);
    if (cached) {
      try {
        const stats = await stat(file);
        if (stats.mtimeMs === cached.mtime && stats.size === cached.size) {
          return; // Use cached data
        }
      } catch (e) {
        // File deleted or unreadable — clean up all associated cache entries
        this._removeCacheEntry(file);
        return;
      }
    }

    // indexFile defends against TOCTOU (file deleted between stat and read);
    // only count successful indexing.
    const ok = await this.indexFile(file);
    if (ok) this.indexedCount++;
  }

  _applyWorkspaceExcludeDirs() {
    const wsConfig = loadWorkspaceConfig(this.root, { quiet: this.quiet });
    if (!wsConfig?.directories) return;
    const extra = [
      ...wsConfig.directories.reference,
      ...wsConfig.directories.archive,
      ...wsConfig.directories.generated,
    ].filter(Boolean);
    this.baseExcludeDirs = [...new Set([...this.baseExcludeDirs, ...extra])];
    this.excludeDirs = [...new Set([...this.baseExcludeDirs, ...this.cliExcludeDirs])];
  }

  shouldExclude(filePath) {
    const base = path.basename(filePath);
    if (base === 'cache.db' || base === 'cache.db-wal' || base === 'cache.db-shm') return true;

    const normalized = normalizePathKey(filePath);
    // Only exclude base dirs (node_modules, .git, etc.) and workspace-configured dirs.
    // CLI --exclude files are still indexed so they can serve as importers in the graph.
    if (this.baseExcludeDirs.some((dir) => matchesPathFragment(normalized, dir))) {
      return true;
    }
    if (this.projectContext && !this.projectContext.isNotGeneratedFile(filePath)) {
      return true;
    }
    return false;
  }

  /**
   * Check whether a file was excluded by the CLI --exclude flag.
   * This is separate from shouldExclude() so that CLI-excluded files are still
   * indexed and participate in the dependency graph (as importers), but are
   * filtered out of report output.
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

  _removeCacheEntry(filePath) {
    const fileKey = normalizePathKey(filePath);
    const cached = this.cache.getFileMetadata(filePath);
    if (cached?.symbols) {
      for (const symName of cached.symbols) {
        const existing = this.cache.getSymbols(symName);
        const filtered = existing.filter((location) => normalizePathKey(location.file) !== fileKey);
        if (filtered.length > 0) {
          this.cache.setSymbols(symName, filtered);
        } else {
          this.cache.deleteSymbol(symName);
        }
      }
    }
    this.cache.deleteFileMetadata(filePath);
    this.cache.deleteParseResult(filePath);
    this.cache.clearDiagnostics(filePath);
  }

  pruneExcludedCacheEntries() {
    for (const filePath of Array.from(this.cache.fileMetadata.keys())) {
      if (!this.shouldExclude(filePath)) continue;
      this._removeCacheEntry(filePath);
    }
  }

  pruneCliExcludedCacheEntries() {
    for (const filePath of Array.from(this.cache.fileMetadata.keys())) {
      if (!this.shouldExcludeCli(filePath)) continue;
      this._removeCacheEntry(filePath);
    }
  }

  async pruneDeletedCacheEntries() {
    const prunedFiles = [];
    if (!this.active) return prunedFiles;
    // Defensive: scan both fileMetadata and parseResults to catch any
    // historical inconsistency where parseResults has a key not in fileMetadata.
    const allCachedFiles = new Set([
      ...Array.from(this.cache.fileMetadata.keys()),
      ...Array.from(this.cache.parseResults.keys()),
    ]);
    // Batch async checks to avoid blocking the event loop on huge caches
    const batchSize = DEFAULTS.FILE_INDEX_PROGRESS_BATCH;
    const files = Array.from(allCachedFiles);
    for (let i = 0; i < files.length; i += batchSize) {
      if (!this.active) return prunedFiles;
      const batch = files.slice(i, i + batchSize);
      for (const filePath of batch) {
        if (!this.active) return prunedFiles;
        if (fs.existsSync(filePath)) continue;
        this._removeCacheEntry(filePath);
        prunedFiles.push(filePath);
      }
      // Yield to event loop between batches
      if (i + batchSize < files.length) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    }
    if (prunedFiles.length > 0 && process.env.DEBUG) {
      if (!this.quiet) {
        console.error(`[FileIndex] Pruned ${prunedFiles.length} deleted files from cache`);
      }
    }
    return prunedFiles;
  }

  async indexFile(filePath) {
    if (!this.active) return false;
    try {
      const fileKey = normalizePathKey(filePath);
      const stats = await stat(filePath);
      if (!this.active) return false;
      const content = await readFile(filePath, 'utf8');
      if (!this.active) return false;
      const ext = path.extname(filePath);

      // Extract symbols
      const symbols = extractSymbols(content, ext);

      if (!this.active) return false;
      // Update file metadata cache
      const { createHash } = require('crypto');
      this.cache.setFileMetadata(filePath, {
        mtime: stats.mtimeMs,
        size: stats.size,
        hash: createHash('sha256').update(content).digest('hex'),
        symbols: symbols.map(s => s.name),
        lineCount: (content.match(/\n/g)?.length || 0) + 1,
      });

      // Update symbol index cache
      for (const symbol of symbols) {
        if (!this.active) return false;
        const existing = this.cache.getSymbols(symbol.name);
        // Remove old entry for this file
        const filtered = existing.filter((l) => normalizePathKey(l.file) !== fileKey);
        filtered.push({
          file: fileKey,
          line: symbol.line,
          type: symbol.type,
          signature: symbol.signature,
        });
        this.cache.setSymbols(symbol.name, filtered);
      }

      return true;
    } catch (e) {
      if (process.env.DEBUG) {
        console.error(`[FileIndex] Failed to index ${filePath}:`, e.message);
      }
      return false;
    }
  }

  // extractSymbols removed — logic moved to ./file-index/symbol-extractors.js
  // as a first-match registry, eliminating the 6-branch else-if chain.

  startWatching() {
    let recursiveSupported = false;
    try {
      const testWatcher = fs.watch(this.root, { recursive: true }, () => {});
      testWatcher.close();
      recursiveSupported = true;
    } catch {
      // Node <20 on Linux does not support recursive watch
    }
    if (!recursiveSupported) {
      console.error('[FileIndex] fs.watch recursive is not supported on this platform; watcher disabled');
      return;
    }

    try {
      const watcher = fs.watch(this.root, { recursive: true }, (eventType, filename) => {
        if (!filename) {
          // On some platforms (notably Windows) delete/rename events may not
          // provide a filename. Defensively prune disappeared files.
          if (eventType === 'rename') {
            setImmediate(() => this._handleRenameWithoutFilename());
          }
          return;
        }
        const normalizedFilename = Buffer.isBuffer(filename) ? filename.toString() : filename;
        const fullPath = path.join(this.root, normalizedFilename);
        if (this.shouldExclude(fullPath)) return;
        this.pendingUpdates.add(fullPath);

        // Debounce updates
        if (this.updateTimer) clearTimeout(this.updateTimer);
        this.updateTimer = setTimeout(() => this.processPending(), DEFAULTS.WATCH_DEBOUNCE_MS);
      });

      watcher.on('error', (e) => {
        if (process.env.DEBUG) {
          console.error('[FileIndex] Watcher error:', e.message);
        }
      });
      
      this.watchers.push(watcher);
    } catch (e) {
      console.error('[FileIndex] Watch failed:', e.message);
    }
  }

  async _handleRenameWithoutFilename() {
    const pruned = await this.pruneDeletedCacheEntries();
    if (pruned.length > 0 && this.onPendingProcessed) {
      try {
        await this.onPendingProcessed(pruned);
      } catch (e) {
        console.error(`[FileIndex] onPendingProcessed failed:`, e.message);
      }
    }
  }

  async processPending() {
    if (!this.active) return;
    // Atomic swap: replace the pending set so that updates arriving during
    // processing are not lost by a subsequent clear() or re-entrant call.
    const updates = this.pendingUpdates;
    this.pendingUpdates = new Set();
    const files = Array.from(updates);

    // Process with small concurrency to keep debounce meaningful while
    // not serializing independent file operations.
    const CONCURRENCY = 5;
    const executing = new Set();
    for (const file of files) {
      if (!this.active) break;
      const promise = this.handleFileChange(file).finally(() => executing.delete(promise));
      executing.add(promise);
      if (executing.size >= CONCURRENCY) {
        await Promise.race(executing);
      }
    }
    if (!this.active) return;
    await Promise.all(executing);

    // Phase 3: 批量通知下游服务（如 dep-graph 增量更新）
    if (this.active && this.onPendingProcessed && files.length > 0) {
      try {
        await this.onPendingProcessed(files);
      } catch (e) {
        console.error(`[FileIndex] onPendingProcessed failed:`, e.message);
      }
    }
  }

  async handleFileChange(filePath) {
    if (!this.active) return;
    try {
      const fileKey = normalizePathKey(filePath);
      const stats = await stat(filePath);
      if (!this.active) return;
      const cached = this.cache.getFileMetadata(filePath);
      
      if (!cached || stats.mtimeMs !== cached.mtime || stats.size !== cached.size) {
        // Remove old symbols first
        if (cached) {
          if (!this.active) return;
          for (const symName of cached.symbols) {
            const existing = this.cache.getSymbols(symName);
            const filtered = existing.filter((l) => normalizePathKey(l.file) !== fileKey);
            if (filtered.length > 0) {
              this.cache.setSymbols(symName, filtered);
            } else {
              this.cache.deleteSymbol(symName);
            }
          }
        }
        
        // Re-index
        if (!this.active) return;
        await this.indexFile(filePath);
      }
    } catch (e) {
      // File deleted — clean up all associated cache entries
      if (this.active) {
        this._removeCacheEntry(filePath);
      }
    }
    
    // Phase 2: 触发外部回调（如诊断检查）
    if (this.active && this.onFileChanged) {
      try {
        this.onFileChanged(filePath);
      } catch (e) {
        // 回调失败不应影响文件索引流程
        console.error(`[FileIndex] onFileChanged callback failed:`, e.message);
      }
    }
  }

  stopWatching() {
    this.active = false;
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
      this.updateTimer = null;
    }
    for (const watcher of this.watchers) {
      try {
        watcher.close();
      } catch (_) {
        // Best effort: individual watcher failure should not block cleanup of others
      }
    }
    this.watchers = [];
  }

  getStats() {
    return {
      ...this.cache.getStats(),
      indexedCount: this.indexedCount,
    };
  }
}

module.exports = {
  FileIndex,
};
