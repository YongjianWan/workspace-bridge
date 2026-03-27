/**
 * Symbol index for fast code navigation
 * Builds and maintains an index of classes, functions, methods
 */
const fs = require('fs');
const path = require('path');

class SymbolIndex {
  constructor() {
    this.symbols = new Map(); // name -> [{file, line, type, signature}]
    this.files = new Map(); // file -> {mtime, symbols: []}
    this.initialized = false;
  }

  async build(rootPath, options = {}) {
    const { include = ['**/*.py', '**/*.js', '**/*.ts'], exclude = ['**/node_modules/**', '**/__pycache__/**', '**/.venv/**'] } = options;
    
    this.root = rootPath;
    const files = this.findFiles(rootPath, include, exclude);
    
    console.error(`[SymbolIndex] Indexing ${files.length} files...`);
    
    for (const file of files) {
      await this.indexFile(file);
    }
    
    this.initialized = true;
    console.error(`[SymbolIndex] Indexed ${this.symbols.size} unique symbols`);
  }

  findFiles(dir, include, exclude) {
    const results = [];
    
    const walk = (current) => {
      try {
        const entries = fs.readdirSync(current, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(current, entry.name);
          
          // Check exclude patterns
          if (exclude.some(p => this.matchPattern(fullPath, p))) continue;
          
          if (entry.isDirectory()) {
            walk(fullPath);
          } else if (entry.isFile() && include.some(p => this.matchPattern(fullPath, p))) {
            results.push(fullPath);
          }
        }
      } catch (e) {
        // Permission denied, etc.
      }
    };
    
    walk(dir);
    return results;
  }

  matchPattern(filePath, pattern) {
    // Simple pattern matching for file extensions
    if (pattern === '**/*.py') return filePath.endsWith('.py');
    if (pattern === '**/*.js') return filePath.endsWith('.js');
    if (pattern === '**/*.ts') return filePath.endsWith('.ts');
    
    // Exclude patterns
    if (pattern.includes('node_modules')) return filePath.includes('node_modules');
    if (pattern.includes('__pycache__')) return filePath.includes('__pycache__');
    if (pattern.includes('.venv')) return filePath.includes('.venv');
    
    return false;
  }

  async indexFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const stat = fs.statSync(filePath);
      const ext = path.extname(filePath);
      
      const symbols = ext === '.py' 
        ? this.parsePython(content, filePath)
        : this.parseJavaScript(content, filePath);
      
      this.files.set(filePath, {
        mtime: stat.mtimeMs,
        symbols: symbols.map(s => s.name)
      });
      
      for (const symbol of symbols) {
        if (!this.symbols.has(symbol.name)) {
          this.symbols.set(symbol.name, []);
        }
        this.symbols.get(symbol.name).push(symbol);
      }
    } catch (e) {
      console.error(`[SymbolIndex] Failed to index ${filePath}:`, e.message);
    }
  }

  parsePython(content, filePath) {
    const symbols = [];
    const lines = content.split('\n');
    
    // Match: class ClassName, def function_name, async def func_name
    const patterns = [
      { regex: /^class\s+(\w+)\s*(?:\(|:)/, type: 'class' },
      { regex: /^(?:async\s+)?def\s+(\w+)\s*\(/, type: 'function' },
    ];
    
    lines.forEach((line, idx) => {
      for (const { regex, type } of patterns) {
        const match = line.match(regex);
        if (match) {
          symbols.push({
            name: match[1],
            type,
            file: filePath,
            line: idx + 1,
            signature: line.trim().slice(0, 100),
          });
        }
      }
    });
    
    return symbols;
  }

  parseJavaScript(content, filePath) {
    const symbols = [];
    const lines = content.split('\n');
    
    const patterns = [
      { regex: /^(?:export\s+)?(?:default\s+)?class\s+(\w+)/, type: 'class' },
      { regex: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/, type: 'function' },
      { regex: /^(?:export\s+)?const\s+(\w+)\s*[=:]/, type: 'constant' },
      { regex: /^(?:export\s+)?(?:async\s+)?(\w+)\s*\([^)]*\)\s*[{=]/, type: 'method' },
    ];
    
    lines.forEach((line, idx) => {
      for (const { regex, type } of patterns) {
        const match = line.match(regex);
        if (match && !match[1].match(/^(if|for|while|switch|catch)$/)) {
          symbols.push({
            name: match[1],
            type,
            file: filePath,
            line: idx + 1,
            signature: line.trim().slice(0, 100),
          });
        }
      }
    });
    
    return symbols;
  }

  findSymbol(name) {
    return this.symbols.get(name) || [];
  }

  searchSymbols(query, maxResults = 20) {
    const results = [];
    const lowerQuery = query.toLowerCase();
    
    for (const [name, locations] of this.symbols) {
      if (name.toLowerCase().includes(lowerQuery)) {
        results.push(...locations);
        if (results.length >= maxResults) break;
      }
    }
    
    return results.slice(0, maxResults);
  }

  getSymbolsInFile(filePath) {
    const fileInfo = this.files.get(filePath);
    if (!fileInfo) return [];
    
    return fileInfo.symbols
      .map(name => this.symbols.get(name))
      .filter(Boolean)
      .flat()
      .filter(s => s.file === filePath);
  }

  invalidateFile(filePath) {
    const fileInfo = this.files.get(filePath);
    if (fileInfo) {
      // Remove old symbols
      for (const symbolName of fileInfo.symbols) {
        const locations = this.symbols.get(symbolName);
        if (locations) {
          const filtered = locations.filter(s => s.file !== filePath);
          if (filtered.length === 0) {
            this.symbols.delete(symbolName);
          } else {
            this.symbols.set(symbolName, filtered);
          }
        }
      }
      this.files.delete(filePath);
    }
  }

  async updateFile(filePath) {
    this.invalidateFile(filePath);
    await this.indexFile(filePath);
  }
}

module.exports = { SymbolIndex };
