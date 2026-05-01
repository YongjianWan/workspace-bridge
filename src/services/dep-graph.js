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
  parseKotlin,
  parseGo,
  parseRust,
} = require('./dep-graph/parsers');
const { resolveImport } = require('./dep-graph/resolvers');
const { normalizePathKey, matchesPathFragment, toRelativePosix } = require('../utils/path');
const {
  getSymbolImpact,
  getChangedFunctionImpact,
  getFunctionReuseHints,
  getFunctionLevelAffectedTests,
} = require('./dep-graph/symbol-impact');
const {
  normalizeHeuristicName,
  buildHeuristicSignature,
  getHeuristicLanguageFamily,
  isTestLikeFile,
} = require('../utils/test-detector');

const readFile = promisify(fs.readFile);

const { DEFAULTS } = require('../config/constants');

// 配置常量
const CONFIG = {
  DEFAULT_CONCURRENCY: 20,      // 默认并发数（内存安全考虑）
  DEFAULT_MAX_DEPTH: DEFAULTS.AFFECTED_TEST_DEPTH,
};

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
    const base = path.basename(filePath);
    if (base === '.workspace-bridge-cache.json') return true;

    const normalized = normalizePathKey(filePath);
    return this.excludeDirs.some((dir) => {
      if (dir === 'node_modules') {
        const relative = toRelativePosix(this.root, filePath);
        return relative.includes('node_modules/') || relative === 'node_modules';
      }
      return matchesPathFragment(normalized, dir);
    });
  }

  normalizeFilePath(filePath) {
    return normalizePathKey(filePath);
  }

  hasFile(filePath) {
    return this.graph.has(this.normalizeFilePath(filePath));
  }

  getFileInfo(filePath) {
    return this.graph.get(this.normalizeFilePath(filePath));
  }

  _readPackageJson() {
    const packageJsonPath = path.join(this.root, 'package.json');
    if (!fs.existsSync(packageJsonPath)) return null;
    return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
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
      /\/(page|layout|loading|error|not-found|route)\.(tsx|jsx|ts|js)$/,
      /\/(template|default)\.(tsx|jsx|ts|js)$/,
    ];
    if (frameworkManagedPatterns.some((pattern) => pattern.test(normalized))) {
      return true;
    }
    if (base === 'vite.config.js' || base === 'vite.config.ts' || base === 'eslint.config.js') {
      return true;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      if (content.startsWith('#!')) return true;
      if (/if\s+__name__\s*==\s*['"]__main__['"]\s*:/.test(content)) return true;
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }

    if (!Array.isArray(exports) || exports.length === 0) {
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
    const candidateFiles = Array.from(this.cache.fileMetadata.keys()).filter((file) => {
      if (this.shouldExclude(file)) return false;
      if (this.projectContext && !this.projectContext.shouldAnalyzeFile(file)) return false;
      return true;
    });
    const files = [];
    const seen = new Set();
    for (const file of candidateFiles) {
      const key = this.normalizeFilePath(file);
      if (seen.has(key)) continue;
      seen.add(key);
      files.push(file);
    }
    
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
      const graphKey = this.normalizeFilePath(filePath);
      const content = await readFile(filePath, 'utf8');
      const ext = path.extname(filePath);
      
      let imports = [];
      let exports = [];
      let importRecords = [];
      let exportRecords = [];
      let functionRecords = [];
      let parseMode = 'none';

      if (ext === '.py') {
        const pyResult = await parsePython(content);
        imports = pyResult.imports;
        exports = pyResult.exports;
        importRecords = pyResult.importRecords || [];
        parseMode = pyResult.parseMode || 'regex';
      } else if (['.js', '.ts', '.jsx', '.tsx'].includes(ext)) {
        ({ imports, exports, importRecords, exportRecords, functionRecords = [], parseMode } = parseJavaScript(content, filePath));
      } else if (ext === '.java') {
        ({ imports, exports, importRecords, exportRecords, functionRecords = [], parseMode } = await parseJava(content));
      } else if (ext === '.kt') {
        ({ imports, exports, importRecords, exportRecords, functionRecords = [], parseMode } = parseKotlin(content));
      } else if (ext === '.go') {
        ({ imports, exports, importRecords, exportRecords, functionRecords = [], parseMode } = parseGo(content));
      } else if (ext === '.rs') {
        ({ imports, exports, importRecords, exportRecords, functionRecords = [], parseMode } = parseRust(content));
      }

      // Resolve relative imports to absolute paths
      const resolvedImportRecords = (importRecords.length > 0 ? importRecords : imports.map((source) => createImportRecord(source)))
        .map((record) => {
          const resolved = resolveImport(filePath, record.source, ext, this.root);
          if (!resolved) return null;
          return {
            ...record,
            resolved: this.normalizeFilePath(resolved),
          };
        })
        .filter(Boolean);
      const resolvedImports = resolvedImportRecords.map((record) => record.resolved).filter((imp) => imp !== graphKey);

      this.graph.set(graphKey, {
        imports: resolvedImports,
        exports,
        importRecords: resolvedImportRecords,
        exportRecords: exportRecords.length > 0 ? exportRecords : exports.map((name) => ({ name })),
        functionRecords: functionRecords.length > 0 ? functionRecords : [],
        parseMode,
        confidence: parseMode === 'ast' ? 'high' : 'medium',
      });

    } catch (e) {
      // 单个文件分析失败不应阻塞整个依赖图构建，记录日志后继续
      console.error(`[DepGraph] Failed to analyze ${filePath}:`, e.message);
    }
  }

  buildReverseGraph() {
    this.reverseGraph.clear();

    for (const [file, info] of this.graph) {
      const seen = new Set();
      for (const imp of info.imports) {
        if (seen.has(imp)) continue;
        seen.add(imp);
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
    return this.getFileInfo(filePath)?.imports || [];
  }

  /**
   * Get files that depend on this file (reverse dependencies)
   */
  getDependents(filePath) {
    return this.reverseGraph.get(this.normalizeFilePath(filePath)) || [];
  }

  /**
   * Calculate impact radius: how many files would be affected by changing this file
   * P3: 增加 via（路径链）和 importedSymbols（导入符号），支撑变更影响解释
   */
  getImpactRadius(filePath, depth = 3) {
    const visited = new Set();
    const queue = [{ file: filePath, level: 0, via: [] }];
    const results = [];

    while (queue.length > 0) {
      const { file, level, via } = queue.shift();

      if (visited.has(file) || level > depth) continue;
      visited.add(file);

      if (level > 0) {
        const currentInfo = this.getFileInfo(file);

        let importedSymbols = [];
        if (currentInfo?.importRecords) {
          const parentFile = via[via.length - 1];
          const matchingImports = currentInfo.importRecords.filter((r) => r.resolved === parentFile);
          for (const record of matchingImports) {
            if (record.imported) importedSymbols.push(...record.imported);
          }
        }

        results.push({
          file,
          level,
          via: [...via],
          importedSymbols: [...new Set(importedSymbols)],
          reason: level === 1 ? 'direct-import' : 'transitive-dependency',
        });
      }

      const dependents = this.getDependents(file);
      for (const dep of dependents) {
        if (!visited.has(dep)) {
          queue.push({ file: dep, level: level + 1, via: level === 0 ? [file] : [...via, file] });
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
        if (this.hasFile(dep)) {
          visit(dep, [...path]);
        }
      }

      stack.delete(file);
    };

    for (const file of this.graph.keys()) {
      visit(file, []);
    }

    return cycles.filter((cycle) => !(cycle.length <= 2 && cycle[0] === cycle[cycle.length - 1]));
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
   * P1: 轻量扫描 importer 文件中的符号使用点
   * 通过简单 regex 查找方法调用/字段访问，补充 importRecords 未 capture 的使用
   * @param {string[]} importerPaths - importer 文件路径列表
   * @param {string[]} symbols - 待检查的符号名
   * @param {string} sourceFilePath - 被导入的源文件路径（用于判断语言）
   * @returns {Set<string>} 被使用的符号集合
   */
  _scanSymbolUsageInImporters(importerPaths, symbols, sourceFilePath) {
    const used = new Set();
    if (!symbols || symbols.length === 0) return used;

    const ext = path.extname(sourceFilePath).toLowerCase();
    const isJavaFamily = ext === '.java' || ext === '.kt';

    for (const importerPath of importerPaths) {
      try {
        const content = fs.readFileSync(importerPath, 'utf-8');
        for (const symbol of symbols) {
          if (used.has(symbol)) continue;
          // 转义正则元字符，防止 symbol 含 $ . ( 等导致 SyntaxError 或错误匹配
          const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          // 方法/函数调用: bar( / Bar(
          const callPattern = new RegExp(`\\b${escaped}\\s*\\(`);
          // 字段/属性访问: .bar / .someField（Java/Kotlin）
          const accessPattern = isJavaFamily ? new RegExp(`\\.${escaped}\\b`) : null;
          if (callPattern.test(content) || (accessPattern && accessPattern.test(content))) {
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

  /**
   * Phase 3: 查找未被引用的 exports（死代码）
   * @returns {Array<{file: string, exports: string[], confidence: 'high'|'medium'|'low'}>}
   * @description 无 importer 的文件 → high confidence。
   *   有 importer 的文件：先检查 importRecords，再轻量扫描 importer 内容中的使用点（P1），
   *   两者都未发现的符号才报告为 dead-export。
   */
  findDeadExports() {
    const deadExports = [];

    for (const [filePath, info] of this.graph) {
      if (info.exports.length === 0) continue;
      if (this.isTestLikeFile(filePath)) continue;
      if (this.isKnownEntryFile(filePath, info.exports)) continue;
      const importers = this.getDependents(filePath);
      if (importers.length === 0) {
        deadExports.push({ file: filePath, exports: info.exports, confidence: 'high' });
        continue;
      }

      let usesAllExports = false;
      const usedNames = new Set();

      for (const importerPath of importers) {
        const importerInfo = this.getFileInfo(importerPath);
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

      let unused = info.exports.filter((name) => !usedNames.has(name));

      // P1: 轻量扫描 importer 文件中的实际使用点，消除 importRecords 未 capture 的误报
      if (unused.length > 0) {
        const scannedUsed = this._scanSymbolUsageInImporters(importers, unused, filePath);
        unused = unused.filter((name) => !scannedUsed.has(name));
      }

      if (unused.length > 0) {
        const confidence = info.parseMode === 'ast' ? 'medium' : 'low';
        deadExports.push({ file: filePath, exports: unused, confidence });
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
        if (!this.hasFile(imp) && path.isAbsolute(imp) && !fs.existsSync(imp)) {
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
    * @returns {Array<{file: string, distance: number, source: string, via?: string[]}>}
   * @description 从起始文件出发，沿反向依赖图 BFS 搜索测试文件
   */
  findAffectedTests(filePath, maxDepth = CONFIG.DEFAULT_MAX_DEPTH, options = {}) {
    const includeHeuristic = options?.includeHeuristic !== false;

    const isTestFile = (f) => isTestLikeFile(f);
    
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
        const result = { file, distance, source: 'graph' };
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

    if (includeHeuristic) {
      // Heuristic supplement: when graph-based mapping misses obvious same-stem tests.
      // Keeps output useful for repos that don't import tests directly.
      const seen = new Set(affectedTests.map((entry) => entry.file));
      const sourceSignature = buildHeuristicSignature(this.root, filePath);
      const sourceFamily = getHeuristicLanguageFamily(filePath);
      const sourceLeaf = normalizeHeuristicName(filePath);

      for (const candidate of this.graph.keys()) {
        if (candidate === filePath) continue;
        if (!isTestFile(candidate)) continue;
        if (seen.has(candidate)) continue;

        const candidateFamily = getHeuristicLanguageFamily(candidate);
        if (sourceFamily !== candidateFamily) continue;

        const candidateSignature = buildHeuristicSignature(this.root, candidate);
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

        if (signatureMatched) {
          affectedTests.push({
            file: candidate,
            distance: maxDepth + 1,
            source: 'heuristic',
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

