/**
 * FileIndex - Unified file indexing with incremental updates
 * Merges SymbolIndex + ContextEngine logic
 * OPTIMIZED: Async indexing with concurrency limit for large repos
 */
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { detectWorkspace, normalizePathKey, matchesPathFragment } = require('../utils/path');

const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const readFile = promisify(fs.readFile);

// Limit concurrent file operations to prevent memory exhaustion
const DEFAULT_CONCURRENCY = 50;
const DEFAULT_EXCLUDE_DIRS = ['node_modules', '__pycache__', '.venv', 'venv', '.git', 'dist', 'build'];

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
  async build(timeoutMs = 300000, options = {}) {
    const startTime = Date.now();
    this.indexedCount = 0;
    const shouldWatch = options.watch !== false;
    if (Array.isArray(options.excludeDirs)) {
      this.excludeDirs = [...new Set([...DEFAULT_EXCLUDE_DIRS, ...options.excludeDirs])];
    }
    const patterns = this.getFilePatterns();
    let timeoutId = null;

    this.pruneExcludedCacheEntries();
    
    // Create overall build timeout
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(`Build timeout after ${timeoutMs}ms`)), timeoutMs);
    });
    
    const buildPromise = (async () => {
      for (const pattern of patterns) {
        await this.indexByPattern(pattern, 5, 120000); // 2 min per pattern
      }
    })();
    
    try {
      await Promise.race([buildPromise, timeoutPromise]);
    } catch (e) {
      if (e.message.includes('timeout')) {
        console.error(`[FileIndex] Build timed out after ${Date.now() - startTime}ms`);
        // Continue with partial index
      } else {
        throw e;
      }
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }

    // CLI mode does not need long-lived watchers.
    if (shouldWatch) {
      this.startWatching();
    }

    console.error(`[FileIndex] Built in ${Date.now() - startTime}ms, indexed ${this.indexedCount} files`);
  }

  getFilePatterns() {
    const patterns = [];
    if (this.workspace.hasPackageJson) {
      patterns.push('**/*.js', '**/*.ts', '**/*.jsx', '**/*.tsx');
    }
    if (this.workspace.hasRequirements || this.workspace.hasPyproject || this.workspace.hasManagePy) {
      patterns.push('**/*.py');
    }
    if (this.workspace.hasJava) {
      patterns.push('**/*.java');
    }
    return patterns.length > 0 ? patterns : ['**/*.js', '**/*.py', '**/*.java'];
  }

  /**
   * Index files by pattern with async iteration and concurrency control
   * Includes timeout protection for large repositories
   */
  async indexByPattern(pattern, maxDepth = 5, timeoutMs = 120000) {
    const ext = pattern.replace('**/*', '');
    const files = [];
    let timeoutId = null;
    
    // Create timeout promise
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(`Indexing timeout after ${timeoutMs}ms`)), timeoutMs);
    });
    
    // Race between indexing and timeout
    const indexingPromise = (async () => {
      // Collect all matching files
      for await (const file of this.findFilesAsync(this.root, ext, maxDepth)) {
        files.push(file);
      }
      
      // Process files with concurrency limit
      await this.processFilesWithLimit(files, this.concurrency);
    })();
    
    try {
      await Promise.race([indexingPromise, timeoutPromise]);
    } catch (e) {
      if (e.message.includes('timeout')) {
        console.error(`[FileIndex] Pattern ${pattern} timed out, indexed ${files.length} files`);
        // Continue with partial results
      } else {
        throw e;
      }
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  /**
   * Async generator for finding files (non-blocking for large repos)
   */
  async* findFilesAsync(dir, ext, maxDepth) {
    const queue = [{ path: dir, depth: 0 }];
    
    while (queue.length > 0) {
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
        
        if (this.shouldExclude(fullPath)) continue;
        
        if (entry.isDirectory()) {
          queue.push({ path: fullPath, depth: depth + 1 });
        } else if (fullPath.endsWith(ext)) {
          yield fullPath;
        }
        
        // Yield to event loop every 100 entries to prevent blocking
        if (i % 100 === 0) {
          await new Promise(resolve => setImmediate(resolve));
        }
      }
    }
  }

  /**
   * Process files with concurrency limit
   */
  async processFilesWithLimit(files, limit) {
    const executing = new Set();
    
    for (const file of files) {
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
        // File deleted, remove from cache
        this.cache.deleteFileMetadata(file);
        return;
      }
    }

    await this.indexFile(file);
    this.indexedCount++;
  }

  shouldExclude(filePath) {
    const normalized = normalizePathKey(filePath);
    if (this.excludeDirs.some((dir) => matchesPathFragment(normalized, dir))) {
      return true;
    }
    if (this.projectContext && !this.projectContext.shouldIndexFile(filePath)) {
      return true;
    }
    return false;
  }

  pruneExcludedCacheEntries() {
    for (const filePath of Array.from(this.cache.fileMetadata.keys())) {
      if (!this.shouldExclude(filePath)) continue;
      const fileKey = normalizePathKey(filePath);
      const cached = this.cache.getFileMetadata(filePath);
      if (cached?.symbols) {
        for (const symName of cached.symbols) {
          const existing = this.cache.getSymbols(symName);
          const filtered = existing.filter((location) => normalizePathKey(location.file) !== fileKey);
          if (filtered.length > 0) {
            this.cache.setSymbols(symName, filtered);
          } else {
            this.cache.symbolIndex.delete(symName);
          }
        }
      }
      this.cache.deleteFileMetadata(filePath);
      this.cache.clearDiagnostics(filePath);
    }
  }

  async indexFile(filePath) {
    try {
      const fileKey = normalizePathKey(filePath);
      const stats = await stat(filePath);
      const content = await readFile(filePath, 'utf8');
      const ext = path.extname(filePath);
      
      // Extract symbols
      const symbols = this.extractSymbols(content, ext);
      
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

    } catch (e) {
      if (process.env.DEBUG) {
        console.error(`[FileIndex] Failed to index ${filePath}:`, e.message);
      }
    }
  }

  extractSymbols(content, ext) {
    const symbols = [];
    const lines = content.split('\n');
    
    if (ext === '.py') {
      // Python: class/def/async def
      lines.forEach((line, idx) => {
        const classMatch = line.match(/^class\s+(\w+)/);
        const funcMatch = line.match(/^(?:async\s+)?def\s+(\w+)/);
        
        if (classMatch) {
          symbols.push({ name: classMatch[1], type: 'class', line: idx + 1, signature: line.trim() });
        } else if (funcMatch) {
          symbols.push({ name: funcMatch[1], type: 'function', line: idx + 1, signature: line.trim() });
        }
      });
    } else if (['.js', '.ts', '.jsx', '.tsx'].includes(ext)) {
      // JS/TS: class/function/const/let/var
      lines.forEach((line, idx) => {
        const classMatch = line.match(/(?:export\s+)?(?:default\s+)?class\s+(\w+)/);
        const funcMatch = line.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)/);
        const constMatch = line.match(/(?:export\s+)?const\s+(\w+)\s*=/);
        
        if (classMatch) {
          symbols.push({ name: classMatch[1], type: 'class', line: idx + 1, signature: line.trim() });
        } else if (funcMatch) {
          symbols.push({ name: funcMatch[1], type: 'function', line: idx + 1, signature: line.trim() });
        } else if (constMatch) {
          symbols.push({ name: constMatch[1], type: 'constant', line: idx + 1, signature: line.trim() });
        }
      });
    } else if (ext === '.java') {
      // Java: top-level class/interface/enum/record
      lines.forEach((line, idx) => {
        const typeMatch = line.match(/\b(?:public\s+)?(?:abstract\s+|final\s+)?(class|interface|enum|record)\s+(\w+)/);
        if (typeMatch) {
          symbols.push({ name: typeMatch[2], type: typeMatch[1], line: idx + 1, signature: line.trim() });
        }
      });
    }
    
    return symbols;
  }

  startWatching() {
    const recursiveSupported = process.platform === 'win32' || process.platform === 'darwin';
    if (!recursiveSupported) {
      console.error('[FileIndex] fs.watch recursive is not supported on this platform; watcher disabled');
      return;
    }

    try {
      const watcher = fs.watch(this.root, { recursive: true }, (eventType, filename) => {
        const fullPath = path.join(this.root, filename);
        if (!filename || this.shouldExclude(fullPath)) return;
        this.pendingUpdates.add(fullPath);
        
        // Debounce updates
        if (this.updateTimer) clearTimeout(this.updateTimer);
        this.updateTimer = setTimeout(() => this.processPending(), 500);
      });
      
      this.watchers.push(watcher);
    } catch (e) {
      console.error('[FileIndex] Watch failed:', e.message);
    }
  }

  async processPending() {
    const files = Array.from(this.pendingUpdates);
    this.pendingUpdates.clear();
    
    for (const file of files) {
      await this.handleFileChange(file);
    }
  }

  async handleFileChange(filePath) {
    try {
      const fileKey = normalizePathKey(filePath);
      const stats = await stat(filePath);
      const cached = this.cache.getFileMetadata(filePath);
      
      if (!cached || stats.mtimeMs > cached.mtime) {
        // Remove old symbols first
        if (cached) {
          for (const symName of cached.symbols) {
            const existing = this.cache.getSymbols(symName);
            const filtered = existing.filter((l) => normalizePathKey(l.file) !== fileKey);
            if (filtered.length > 0) {
              this.cache.setSymbols(symName, filtered);
            } else {
              this.cache.symbolIndex.delete(symName);
            }
          }
        }
        
        // Re-index
        await this.indexFile(filePath);
      }
    } catch (e) {
      // File deleted
      this.cache.deleteFileMetadata(filePath);
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
      watcher.close();
    }
    this.watchers = [];
  }

  // Query methods
  findSymbol(name) {
    return this.cache.getSymbols(name);
  }

  searchSymbols(query, maxResults = 20) {
    const results = [];
    const lowerQuery = query.toLowerCase();
    
    // Iterate through all cached symbols
    for (const [name, locations] of this.cache.symbolIndex || []) {
      if (name.toLowerCase().includes(lowerQuery)) {
        results.push(...locations.map(l => ({ name, ...l })));
        if (results.length >= maxResults) break;
      }
    }
    
    return results.slice(0, maxResults);
  }

  getFileSymbols(filePath) {
    const meta = this.cache.getFileMetadata(filePath);
    if (!meta) return [];
    const fileKey = normalizePathKey(filePath);

    return meta.symbols.map(name => ({
      name,
      locations: this.cache.getSymbols(name).filter((l) => normalizePathKey(l.file) === fileKey),
    })).filter(s => s.locations.length > 0);
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
