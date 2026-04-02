/**
 * DependencyGraph - Import relationship analysis
 * Builds graph of import dependencies, computes impact radius
 */
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const {
  createImportRecord,
  parsePython,
  parseJavaScript,
  parseJava,
} = require('./dep-graph/parsers');
const { resolveImport } = require('./dep-graph/resolvers');
const {
  getSymbolImpact,
  getChangedFunctionImpact,
  getFunctionReuseHints,
  getFunctionLevelAffectedTests,
} = require('./dep-graph/symbol-impact');

const readFile = promisify(fs.readFile);

// 配置常量
const CONFIG = {
  DEFAULT_CONCURRENCY: 20,      // 默认并发数（内存安全考虑）
  DEFAULT_MAX_DEPTH: 5,         // affected_tests 默认搜索深度
};

function normalizeStem(filePath) {
  const base = path.basename(filePath, path.extname(filePath)).toLowerCase();
  return base.replace(/(\.test|\.spec|_test|^test_)/g, '');
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
    this.projectContext = options.projectContext || null;
  }

  shouldExclude(filePath) {
    const normalized = String(filePath || '').replace(/\\/g, '/').toLowerCase();
    return this.excludeDirs.some((dir) => normalized.includes(`/${String(dir).replace(/\\/g, '/').toLowerCase()}/`) || normalized.endsWith(`/${String(dir).replace(/\\/g, '/').toLowerCase()}`));
  }

  _readPackageJson() {
    try {
      const packageJsonPath = path.join(this.root, 'package.json');
      if (!fs.existsSync(packageJsonPath)) return null;
      return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    } catch (e) {
      return null;
    }
  }

  _collectEntryFiles() {
    const entries = new Set();
    const packageJson = this.packageJson;
    if (!packageJson) return entries;

    const addEntry = (value) => {
      if (typeof value !== 'string' || !value.trim()) return;
      const resolved = path.resolve(this.root, value);
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
    const normalized = filePath.replace(/\\/g, '/').toLowerCase();
    const base = path.basename(normalized);
    return (
      normalized.includes('/test/') ||
      normalized.includes('/tests/') ||
      normalized.includes('/src/test/java/') ||
      normalized.includes('/__tests__/') ||
      /\.test\./.test(base) ||
      /\.spec\./.test(base) ||
      /(test|tests|it)\.java$/i.test(base) ||
      /^test.*\.py$/i.test(base) ||
      base === 'tests.py' ||
      /^test_/.test(base) ||
      /_test\./.test(base)
    );
  }

  isKnownEntryFile(filePath, exports) {
    if (this.entryFiles.has(filePath)) return true;

    const normalized = filePath.replace(/\\/g, '/').toLowerCase();
    const base = path.basename(normalized);
    const frameworkManagedPatterns = [
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
    ];
    if (frameworkManagedPatterns.some((pattern) => pattern.test(normalized))) {
      return true;
    }
    if (base === 'vite.config.js' || base === 'vite.config.ts' || base === 'eslint.config.js') {
      return true;
    }

    if (!Array.isArray(exports) || exports.length === 0) {
      return false;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      if (content.startsWith('#!')) return true;
    } catch (e) {
      return false;
    }

    return false;
  }

  /**
   * Build dependency graph from all indexed files
   */
  async build() {
    const startTime = Date.now();
    
    // Get all files from cache
    const files = Array.from(this.cache.fileMetadata.keys()).filter((file) => {
      if (this.shouldExclude(file)) return false;
      if (this.projectContext && !this.projectContext.shouldAnalyzeFile(file)) return false;
      return true;
    });
    
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
      let importRecords = [];
      let exportRecords = [];
      let parseMode = 'none';

      if (ext === '.py') {
        const pyResult = await parsePython(content);
        imports = pyResult.imports;
        exports = pyResult.exports;
        importRecords = pyResult.importRecords || [];
        parseMode = pyResult.parseMode || 'regex';
      } else if (['.js', '.ts', '.jsx', '.tsx'].includes(ext)) {
        ({ imports, exports, importRecords, exportRecords, parseMode } = parseJavaScript(content, filePath));
      } else if (ext === '.java') {
        ({ imports, exports, importRecords, exportRecords, parseMode } = parseJava(content));
      }

      // Resolve relative imports to absolute paths
      const resolvedImportRecords = (importRecords.length > 0 ? importRecords : imports.map((source) => createImportRecord(source)))
        .map((record) => {
          const resolved = resolveImport(filePath, record.source, ext, this.root);
          if (!resolved) return null;
          return {
            ...record,
            resolved,
          };
        })
        .filter(Boolean);
      const resolvedImports = resolvedImportRecords.map((record) => record.resolved);

      this.graph.set(filePath, {
        imports: resolvedImports,
        exports,
        importRecords: resolvedImportRecords,
        exportRecords: exportRecords.length > 0 ? exportRecords : exports.map((name) => ({ name })),
        parseMode,
      });

    } catch (e) {
      // 单个文件分析失败不应阻塞整个依赖图构建，记录日志后继续
      console.error(`[DepGraph] Failed to analyze ${filePath}:`, e.message);
    }
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
      if (this.isTestLikeFile(filePath)) continue;
      if (this.isKnownEntryFile(filePath, info.exports)) continue;
      const importers = this.reverseGraph.get(filePath) || [];
      if (importers.length === 0) {
        deadExports.push({ file: filePath, exports: info.exports, confidence: 'high' });
        continue;
      }

      let usesAllExports = false;
      const usedNames = new Set();

      for (const importerPath of importers) {
        const importerInfo = this.graph.get(importerPath);
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

      if (usesAllExports) {
        continue;
      }

      const unused = info.exports.filter((name) => !usedNames.has(name));
      if (unused.length > 0) {
        deadExports.push({ file: filePath, exports: unused, confidence: 'medium' });
      }
    }

    return deadExports;
  }

  /**
   * Phase 3: 查找解析失败的 imports
   * @returns {Array<{file: string, import: string, resolvedTo: string}>}
   * @description info.imports 已经是 analyzeFile 里 resolveImport() 处理过的绝对路径。
   *   这里只报告真实不存在的路径；静态资源（如 json/css）即使未被索引，也不应视为 unresolved。
   */
  findUnresolvedImports() {
    const unresolved = [];

    for (const [filePath, info] of this.graph) {
      for (const imp of info.imports) {
        if (!this.graph.has(imp) && path.isAbsolute(imp) && !fs.existsSync(imp)) {
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
      if (this.isTestLikeFile(f)) return true;
      const basename = path.basename(f);
      if (testPatterns.some(p => p.test(basename))) return true;
      const dir = path.dirname(f).replace(/\\/g, '/').toLowerCase();
      if (dir.includes('/tests/') || dir.includes('/test/') || dir.includes('/__tests__/')) return true;
      if (dir.includes('/src/test/java/')) return true;
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

    // Heuristic supplement: when graph-based mapping misses obvious same-stem tests.
    // Keeps output useful for repos that don't import tests directly.
    const seen = new Set(affectedTests.map((entry) => entry.file));
    const sourceStem = normalizeStem(filePath);
    const sourceExt = path.extname(filePath).toLowerCase();
    const sourceBase = path.basename(filePath, sourceExt);
    const sourceDir = path.dirname(filePath).replace(/\\/g, '/').toLowerCase();

    for (const candidate of this.graph.keys()) {
      if (candidate === filePath) continue;
      if (!isTestFile(candidate)) continue;
      if (seen.has(candidate)) continue;

      const candidateExt = path.extname(candidate).toLowerCase();
      const candidateStem = normalizeStem(candidate);
      const candidateBase = path.basename(candidate, candidateExt).toLowerCase();
      const candidateDir = path.dirname(candidate).replace(/\\/g, '/').toLowerCase();

      let match = false;
      if (sourceExt === '.java') {
        // Java: src/main/java/X.java -> src/test/java/XTest.java
        match = candidateStem === sourceStem || candidateBase.includes(`${sourceStem}test`);
      } else if (sourceExt === '.py') {
        // Python: foo.py -> test_foo.py / foo_test.py
        match = candidateStem === sourceStem;
      } else if (['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'].includes(sourceExt)) {
        // JS/TS: foo.ts -> foo.test.ts / foo.spec.ts
        match = candidateStem === sourceStem;
      }

      // Folder affinity: prioritize test folders near source tree.
      if (match) {
        const nearBy = candidateDir.includes('/test/') || candidateDir.includes('/tests/') || candidateDir.includes('/src/test/java/');
        const sameRootHint = sourceDir.split('/').some((part) => part && candidateDir.includes(part));
        if (nearBy || sameRootHint) {
          affectedTests.push({
            file: candidate,
            distance: maxDepth + 1,
            via: ['heuristic:naming'],
          });
          seen.add(candidate);
        }
      }
    }

    return affectedTests;
  }

  getScopeSummary() {
    const files = Array.from(this.cache.fileMetadata.keys()).filter((file) => !this.shouldExclude(file));
    if (this.projectContext) {
      return this.projectContext.summarizeFiles(files);
    }

    return {
      configPath: null,
      hasConfig: false,
      counts: {
        totalFiles: files.length,
        mainlineFiles: files.length,
        nonMainlineFiles: 0,
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

module.exports = {
  DependencyGraph,
};

