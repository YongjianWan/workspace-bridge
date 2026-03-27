/**
 * FileIndex - Unified file indexing with incremental updates
 * Merges SymbolIndex + ContextEngine logic
 */
const fs = require('fs');
const path = require('path');
const { detectWorkspace } = require('../utils/path');

class FileIndex {
  constructor(workspaceRoot, cache) {
    this.root = workspaceRoot;
    this.cache = cache;
    this.workspace = detectWorkspace(workspaceRoot);
    this.watchers = [];
    this.pendingUpdates = new Set();
    this.updateTimer = null;
  }

  /**
   * Initial build: index all relevant files
   */
  async build() {
    const startTime = Date.now();
    const patterns = this.getFilePatterns();
    
    for (const pattern of patterns) {
      await this.indexByPattern(pattern);
    }

    // Start watching for changes
    this.startWatching();

    console.error(`[FileIndex] Built in ${Date.now() - startTime}ms`);
  }

  getFilePatterns() {
    const patterns = [];
    if (this.workspace.hasPackageJson) {
      patterns.push('**/*.js', '**/*.ts', '**/*.jsx', '**/*.tsx');
    }
    if (this.workspace.hasRequirements || this.workspace.hasPyproject || this.workspace.hasManagePy) {
      patterns.push('**/*.py');
    }
    return patterns.length > 0 ? patterns : ['**/*.js', '**/*.py'];
  }

  async indexByPattern(pattern, maxDepth = 5) {
    const files = this.findFiles(this.root, pattern, maxDepth);
    
    for (const file of files) {
      // Skip if cache has fresh data
      const cached = this.cache.getFileMetadata(file);
      if (cached) {
        try {
          const stat = fs.statSync(file);
          if (stat.mtimeMs === cached.mtime && stat.size === cached.size) {
            continue; // Use cached data
          }
        } catch (e) {
          // File deleted, remove from cache
          this.cache.deleteFileMetadata(file);
          continue;
        }
      }

      await this.indexFile(file);
    }
  }

  findFiles(dir, pattern, maxDepth) {
    const results = [];
    const ext = pattern.replace('**/*', '');
    
    const walk = (current, depth) => {
      if (depth > maxDepth) return;
      try {
        const entries = fs.readdirSync(current, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(current, entry.name);
          
          if (this.shouldExclude(fullPath)) continue;
          
          if (entry.isDirectory()) {
            walk(fullPath, depth + 1);
          } else if (fullPath.endsWith(ext)) {
            results.push(fullPath);
          }
        }
      } catch (e) {}
    };
    
    walk(dir, 0);
    return results;
  }

  shouldExclude(filePath) {
    const exclude = ['node_modules', '__pycache__', '.venv', 'venv', '.git', 'dist', 'build'];
    return exclude.some(e => filePath.includes(e));
  }

  async indexFile(filePath) {
    try {
      const stat = fs.statSync(filePath);
      const content = fs.readFileSync(filePath, 'utf8');
      const ext = path.extname(filePath);
      
      // Extract symbols
      const symbols = this.extractSymbols(content, ext);
      
      // Update file metadata cache
      this.cache.setFileMetadata(filePath, {
        mtime: stat.mtimeMs,
        size: stat.size,
        symbols: symbols.map(s => s.name),
        lineCount: content.split('\n').length,
      });

      // Update symbol index cache
      for (const symbol of symbols) {
        const existing = this.cache.getSymbols(symbol.name);
        // Remove old entry for this file
        const filtered = existing.filter(l => l.file !== filePath);
        filtered.push({
          file: filePath,
          line: symbol.line,
          type: symbol.type,
          signature: symbol.signature,
        });
        this.cache.setSymbols(symbol.name, filtered);
      }

    } catch (e) {
      console.error(`[FileIndex] Failed to index ${filePath}:`, e.message);
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
    }
    
    return symbols;
  }

  startWatching() {
    try {
      const watcher = fs.watch(this.root, { recursive: true }, (eventType, filename) => {
        if (!filename || this.shouldExclude(filename)) return;
        
        const fullPath = path.join(this.root, filename);
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
      const stat = fs.statSync(filePath);
      const cached = this.cache.getFileMetadata(filePath);
      
      if (!cached || stat.mtimeMs > cached.mtime) {
        // Remove old symbols first
        if (cached) {
          for (const symName of cached.symbols) {
            const existing = this.cache.getSymbols(symName);
            const filtered = existing.filter(l => l.file !== filePath);
            if (filtered.length === 0) {
              // Find all keys with empty arrays and delete them
              // Note: Map doesn't have a way to find keys by value efficiently
              // This is a simplified approach
            } else {
              this.cache.setSymbols(symName, filtered);
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
  }

  stopWatching() {
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
    
    return meta.symbols.map(name => ({
      name,
      locations: this.cache.getSymbols(name).filter(l => l.file === filePath),
    })).filter(s => s.locations.length > 0);
  }

  getStats() {
    return this.cache.getStats();
  }
}

module.exports = {
  FileIndex,
};
