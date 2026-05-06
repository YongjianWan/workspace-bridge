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
const { CACHE_FILENAME } = require('./cache');

const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const readFile = promisify(fs.readFile);

// Limit concurrent file operations to prevent memory exhaustion
const DEFAULT_CONCURRENCY = 50;
const DEFAULT_EXCLUDE_DIRS = ['node_modules', '__pycache__', '.venv', 'venv', '.git', 'dist', 'build', '.next', '.nuxt', '.svelte-kit', 'out', '.turbo', 'coverage', '.cache'];

class FileIndex {
  constructor(workspaceRoot, cache, options = {}) {
    this.root = workspaceRoot;
    this.cache = cache;
    this.workspace = detectWorkspace(workspaceRoot);
    this.projectContext = options.projectContext || null;
    this.watchers = [];
    this.pendingUpdates = new Set();
    this.updateTimer = null;
    this.concurrency = options.concurrency || DEFAULT_CONCURRENCY;
    this.indexedCount = 0;
    this.excludeDirs = [...new Set([...DEFAULT_EXCLUDE_DIRS, ...(options.excludeDirs || [])])];
  }

  /**
   * Initial build: index all relevant files
   */
  async build(timeoutMs = DEFAULTS.FILE_INDEX_BUILD_TIMEOUT_MS, options = {}) {
    const startTime = Date.now();
    this.indexedCount = 0;
    const shouldWatch = options.watch !== false;
    if (Array.isArray(options.excludeDirs)) {
      this.excludeDirs = [...new Set([...DEFAULT_EXCLUDE_DIRS, ...options.excludeDirs])];
    }
    this._applyWorkspaceExcludeDirs();
    const patterns = this.getFilePatterns();

    this.pruneExcludedCacheEntries();

    for (const pattern of patterns) {
      if (Date.now() - startTime > timeoutMs) {
        console.error(`[FileIndex] Build timed out after ${Date.now() - startTime}ms`);
        break;
      }
      await this.indexByPattern(pattern, DEFAULTS.FILE_INDEX_MAX_DEPTH, DEFAULTS.FILE_INDEX_PATTERN_TIMEOUT_MS);
    }

    // Remove cache entries for files deleted since last build
    await this.pruneDeletedCacheEntries();

    // CLI mode does not need long-lived watchers.
    if (shouldWatch) {
      this.startWatching();
    }

    console.error(`[FileIndex] Built in ${Date.now() - startTime}ms, indexed ${this.indexedCount} files`);
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

    for (const file of files) {
      if (signal?.aborted) break;
      const promise = this.processFile(file).then(() => {
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
    const wsConfig = loadWorkspaceConfig(this.root);
    if (!wsConfig?.directories) return;
    const extra = [
      ...wsConfig.directories.reference,
      ...wsConfig.directories.archive,
      ...wsConfig.directories.generated,
    ].filter(Boolean);
    this.excludeDirs = [...new Set([...this.excludeDirs, ...extra])];
  }

  shouldExclude(filePath) {
    const base = path.basename(filePath);
    if (base === CACHE_FILENAME) return true;

    const normalized = normalizePathKey(filePath);
    if (this.excludeDirs.some((dir) => matchesPathFragment(normalized, dir))) {
      return true;
    }
    if (this.projectContext && !this.projectContext.isNotGeneratedFile(filePath)) {
      return true;
    }
    return false;
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

  async pruneDeletedCacheEntries() {
    let pruned = 0;
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
      const batch = files.slice(i, i + batchSize);
      for (const filePath of batch) {
        if (fs.existsSync(filePath)) continue;
        this._removeCacheEntry(filePath);
        pruned += 1;
      }
      // Yield to event loop between batches
      if (i + batchSize < files.length) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    }
    if (pruned > 0 && process.env.DEBUG) {
      console.error(`[FileIndex] Pruned ${pruned} deleted files from cache`);
    }
  }

  async indexFile(filePath) {
    try {
      const fileKey = normalizePathKey(filePath);
      const stats = await stat(filePath);
      const content = await readFile(filePath, 'utf8');
      const ext = path.extname(filePath);

      // Extract symbols
      const symbols = extractSymbols(content, ext);

      // Update file metadata cache
      this.cache.setFileMetadata(filePath, {
        mtime: stats.mtimeMs,
        size: stats.size,
        symbols: symbols.map(s => s.name),
        lineCount: content.split('\n').length,
      });

      // Update symbol index cache
      for (const symbol of symbols) {
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
        if (!filename) return;
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

  async processPending() {
    const files = Array.from(this.pendingUpdates);
    this.pendingUpdates.clear();

    // Process with small concurrency to keep debounce meaningful while
    // not serializing independent file operations.
    const CONCURRENCY = 5;
    const executing = new Set();
    for (const file of files) {
      const promise = this.handleFileChange(file).finally(() => executing.delete(promise));
      executing.add(promise);
      if (executing.size >= CONCURRENCY) {
        await Promise.race(executing);
      }
    }
    await Promise.all(executing);

    // Phase 3: 批量通知下游服务（如 dep-graph 增量更新）
    if (this.onPendingProcessed && files.length > 0) {
      try {
        await this.onPendingProcessed(files);
      } catch (e) {
        console.error(`[FileIndex] onPendingProcessed failed:`, e.message);
      }
    }
  }

  async handleFileChange(filePath) {
    try {
      const fileKey = normalizePathKey(filePath);
      const stats = await stat(filePath);
      const cached = this.cache.getFileMetadata(filePath);
      
      if (!cached || stats.mtimeMs !== cached.mtime || stats.size !== cached.size) {
        // Remove old symbols first
        if (cached) {
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
        await this.indexFile(filePath);
      }
    } catch (e) {
      // File deleted — clean up all associated cache entries
      this._removeCacheEntry(filePath);
    }
    
    // Phase 2: 触发外部回调（如诊断检查）
    if (this.onFileChanged) {
      try {
        this.onFileChanged(filePath);
      } catch (e) {
        // 回调失败不应影响文件索引流程
        console.error(`[FileIndex] onFileChanged callback failed:`, e.message);
      }
    }
  }

  stopWatching() {
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
