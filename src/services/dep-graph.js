/**
 * DependencyGraph - Import relationship analysis
 * Builds graph of import dependencies, computes impact radius
 */
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const readFile = promisify(fs.readFile);

// 配置常量
const CONFIG = {
  DEFAULT_CONCURRENCY: 20,      // 默认并发数（内存安全考虑）
  DEFAULT_MAX_DEPTH: 5,         // affected_tests 默认搜索深度
};

class DependencyGraph {
  constructor(workspaceRoot, cache) {
    this.root = workspaceRoot;
    this.cache = cache;
    this.graph = new Map(); // file -> {imports: [], exports: []}
    this.reverseGraph = new Map(); // file -> [files that import it]
  }

  /**
   * Build dependency graph from all indexed files
   */
  async build() {
    const startTime = Date.now();
    
    // Get all files from cache
    const files = Array.from(this.cache.fileMetadata.keys());
    
    // Process with concurrency limit (same pattern as FileIndex)
    await this._processFilesWithLimit(files, CONFIG.DEFAULT_CONCURRENCY);

    // Build reverse graph
    this.buildReverseGraph();

    console.error(`[DepGraph] Built in ${Date.now() - startTime}ms: ${this.graph.size} files`);
  }

  /**
   * Process files with concurrency limit (reuse FileIndex pattern)
   */
  async _processFilesWithLimit(files, limit) {
    const executing = new Set();
    
    for (const file of files) {
      const promise = this.analyzeFile(file).then(() => {
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
   * Analyze a single file for imports/exports
   */
  async analyzeFile(filePath) {
    try {
      const content = await readFile(filePath, 'utf8');
      const ext = path.extname(filePath);
      
      let imports = [];
      let exports = [];

      if (ext === '.py') {
        ({ imports, exports } = this.parsePython(content));
      } else if (['.js', '.ts', '.jsx', '.tsx'].includes(ext)) {
        ({ imports, exports } = this.parseJavaScript(content));
      }

      // Resolve relative imports to absolute paths
      const resolvedImports = imports
        .map(imp => this.resolveImport(filePath, imp, ext))
        .filter(Boolean);

      this.graph.set(filePath, {
        imports: resolvedImports,
        exports,
      });

    } catch (e) {
      // 单个文件分析失败不应阻塞整个依赖图构建，记录日志后继续
      console.error(`[DepGraph] Failed to analyze ${filePath}:`, e.message);
    }
  }

  parsePython(content) {
    const imports = [];
    const exports = []; // Python doesn't have exports, but we track public symbols

    // Match: import X, from X import Y
    const importRegex = /^(?:from\s+(\S+)\s+import|import\s+(\S+))/gm;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      const module = match[1] || match[2];
      if (module) {
        imports.push(module);
      }
    }

    // Find public classes/functions (not starting with _)
    const classRegex = /^class\s+(\w+)/gm;
    const funcRegex = /^def\s+(\w+)/gm;
    
    while ((match = classRegex.exec(content)) !== null) {
      if (!match[1].startsWith('_')) exports.push(match[1]);
    }
    while ((match = funcRegex.exec(content)) !== null) {
      if (!match[1].startsWith('_')) exports.push(match[1]);
    }

    return { imports, exports };
  }

  parseJavaScript(content) {
    const imports = [];
    const exports = [];

    // ES6 imports: import X from 'Y', import { X } from 'Y'
    const importRegex = /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"]([^'"]+)['"]/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      imports.push(match[1]);
    }

    // CommonJS: require('X')
    const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = requireRegex.exec(content)) !== null) {
      imports.push(match[1]);
    }

    // ES6 exports: export { X }, export const X, export default X
    const exportRegex = /export\s+(?:\{[^}]*\}|(?:default\s+)?(?:class|function|const|let|var)\s+(\w+)|default\s+(\w+))/g;
    while ((match = exportRegex.exec(content)) !== null) {
      const name = match[1] || match[2];
      if (name) exports.push(name);
    }

    return { imports, exports };
  }

  resolveImport(fromFile, importPath, ext) {
    // Skip node_modules and built-ins
    if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
      return null; // External module
    }

    const fromDir = path.dirname(fromFile);
    let resolved;

    if (importPath.startsWith('.')) {
      // Relative import
      resolved = path.resolve(fromDir, importPath);
    } else {
      resolved = importPath;
    }

    // Try extensions
    const extensions = ext === '.py' ? ['.py', '/__init__.py'] : ['.js', '.ts', '.jsx', '.tsx', '/index.js'];
    
    for (const tryExt of ['', ...extensions]) {
      const fullPath = resolved + tryExt;
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    }

    return resolved; // Return unresolved for info
  }

  buildReverseGraph() {
    this.reverseGraph.clear();
    
    for (const [file, info] of this.graph) {
      for (const imp of info.imports) {
        if (!this.reverseGraph.has(imp)) {
          this.reverseGraph.set(imp, []);
        }
        this.reverseGraph.get(imp).push(file);
      }
    }
  }

  /**
   * Get direct dependencies of a file
   */
  getDependencies(filePath) {
    return this.graph.get(filePath)?.imports || [];
  }

  /**
   * Get files that depend on this file (reverse dependencies)
   */
  getDependents(filePath) {
    return this.reverseGraph.get(filePath) || [];
  }

  /**
   * Calculate impact radius: how many files would be affected by changing this file
   */
  getImpactRadius(filePath, depth = 3) {
    const visited = new Set();
    const queue = [{ file: filePath, level: 0 }];
    const results = [];

    while (queue.length > 0) {
      const { file, level } = queue.shift();
      
      if (visited.has(file) || level > depth) continue;
      visited.add(file);

      if (level > 0) {
        results.push({ file, level });
      }

      const dependents = this.getDependents(file);
      for (const dep of dependents) {
        if (!visited.has(dep)) {
          queue.push({ file: dep, level: level + 1 });
        }
      }
    }

    return results;
  }

  /**
   * Find circular dependencies
   */
  findCircularDependencies() {
    const cycles = [];
    const visited = new Set();
    const stack = new Set();

    const visit = (file, path) => {
      if (stack.has(file)) {
        // Found cycle
        const cycleStart = path.indexOf(file);
        cycles.push(path.slice(cycleStart).concat([file]));
        return;
      }

      if (visited.has(file)) return;

      visited.add(file);
      stack.add(file);
      path.push(file);

      const deps = this.getDependencies(file);
      for (const dep of deps) {
        if (this.graph.has(dep)) {
          visit(dep, [...path]);
        }
      }

      stack.delete(file);
    };

    for (const file of this.graph.keys()) {
      visit(file, []);
    }

    return cycles;
  }

  /**
   * Get unused exports in a file
   */
  getUnusedExports(filePath) {
    const info = this.graph.get(filePath);
    if (!info) return [];

    const unused = [];
    for (const exp of info.exports) {
      // Check if any file imports this symbol
      let isUsed = false;
      for (const [f, i] of this.graph) {
        if (f === filePath) continue;
        // Simple check: does the import contain the export name
        // Real implementation would need more sophisticated analysis
        if (i.imports.some(imp => imp.includes(exp) || imp.includes(path.basename(filePath, path.extname(filePath))))) {
          isUsed = true;
          break;
        }
      }
      if (!isUsed) unused.push(exp);
    }

    return unused;
  }

  getStats() {
    return {
      files: this.graph.size,
      totalImports: Array.from(this.graph.values()).reduce((sum, i) => sum + i.imports.length, 0),
      totalExports: Array.from(this.graph.values()).reduce((sum, i) => sum + i.exports.length, 0),
      cycles: this.findCircularDependencies().length,
    };
  }

  /**
   * Phase 3: 查找未被引用的 exports（死代码）
   * @returns {Array<{file: string, exports: string[], confidence: 'high'}>}
   * @description 只报告没有任何 importer 的文件（high confidence）。
   *   有 importer 的文件无法在没有 AST 的情况下判断符号级别的使用情况，不做猜测。
   */
  findDeadExports() {
    const deadExports = [];

    for (const [filePath, info] of this.graph) {
      if (info.exports.length === 0) continue;
      const importers = this.reverseGraph.get(filePath) || [];
      if (importers.length === 0) {
        deadExports.push({ file: filePath, exports: info.exports, confidence: 'high' });
      }
    }

    return deadExports;
  }

  /**
   * Phase 3: 查找解析失败的 imports
   * @returns {Array<{file: string, import: string, resolvedTo: string}>}
   * @description info.imports 已经是 analyzeFile 里 resolveImport() 处理过的绝对路径。
   *   不在 graph 中 = 文件不存在或未被索引。无需再调 resolveImport，无同步 IO。
   */
  findUnresolvedImports() {
    const unresolved = [];

    for (const [filePath, info] of this.graph) {
      for (const imp of info.imports) {
        if (!this.graph.has(imp) && path.isAbsolute(imp)) {
          unresolved.push({ file: filePath, import: imp, resolvedTo: imp });
        }
      }
    }

    return unresolved;
  }

  /**
   * Phase 3: 查找受文件变更影响的测试文件
   * @param {string} filePath - 起始文件路径
   * @param {number} [maxDepth=5] - 最大搜索深度
   * @returns {Array<{file: string, distance: number, via?: string[]}>}
   * @description 从起始文件出发，沿反向依赖图 BFS 搜索测试文件
   */
  findAffectedTests(filePath, maxDepth = CONFIG.DEFAULT_MAX_DEPTH) {
    const testPatterns = [
      /\.test\./,           // *.test.*
      /\.spec\./,           // *.spec.*
      /^test_/,             // test_*
      /_test\./,            // *_test.*
    ];
    
    const isTestFile = (f) => {
      const basename = path.basename(f);
      if (testPatterns.some(p => p.test(basename))) return true;
      // 检查是否在 tests/, test/, __tests__/ 目录下
      const dir = path.dirname(f).toLowerCase();
      if (dir.includes('/tests/') || dir.includes('/test/') || dir.includes('/__tests__/')) return true;
      if (dir.endsWith('/tests') || dir.endsWith('/test') || dir.endsWith('/__tests__')) return true;
      return false;
    };
    
    // BFS 搜索
    const visited = new Map(); // file -> {distance, via}
    const queue = [{ file: filePath, distance: 0, via: [] }];
    const affectedTests = [];
    
    while (queue.length > 0) {
      const { file, distance, via } = queue.shift();
      
      if (visited.has(file)) continue;
      visited.set(file, { distance, via });
      
      // 如果是测试文件且不是起始文件，记录结果
      if (file !== filePath && isTestFile(file)) {
        const result = { file, distance };
        if (via.length > 0) {
          result.via = via;
        }
        affectedTests.push(result);
      }
      
      // 继续 BFS（限制深度）
      if (distance < maxDepth) {
        const dependents = this.getDependents(file);
        for (const dep of dependents) {
          if (!visited.has(dep)) {
            queue.push({
              file: dep,
              distance: distance + 1,
              via: [...via, file],
            });
          }
        }
      }
    }
    
    return affectedTests;
  }
}

module.exports = {
  DependencyGraph,
};
