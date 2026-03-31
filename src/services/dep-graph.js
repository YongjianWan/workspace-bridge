/**
 * DependencyGraph - Import relationship analysis
 * Builds graph of import dependencies, computes impact radius
 */
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { spawn } = require('child_process');

const readFile = promisify(fs.readFile);

// Optional: @babel/parser for accurate AST parsing
let babelParser = null;
try {
  babelParser = require('@babel/parser');
} catch (e) {
  // babel parser not available, fallback to regex
}

// 配置常量
const CONFIG = {
  DEFAULT_CONCURRENCY: 20,      // 默认并发数（内存安全考虑）
  DEFAULT_MAX_DEPTH: 5,         // affected_tests 默认搜索深度
};

function uniqueNames(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function normalizeImportedName(name) {
  if (!name) return null;
  const trimmed = String(name).trim();
  if (!trimmed || trimmed === 'type') return null;
  return trimmed.replace(/^type\s+/, '').trim() || null;
}

function parseNamedBindings(raw) {
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const withoutType = part.replace(/^type\s+/, '').trim();
      const [imported] = withoutType.split(/\s+as\s+/i);
      return normalizeImportedName(imported);
    })
    .filter(Boolean);
}

function createImportRecord(source, options = {}) {
  return {
    source,
    imported: uniqueNames(options.imported || []),
    usesAllExports: Boolean(options.usesAllExports),
  };
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
      normalized.includes('/__tests__/') ||
      /\.test\./.test(base) ||
      /\.spec\./.test(base) ||
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

      if (ext === '.py') {
        const pyResult = await this.parsePython(content);
        imports = pyResult.imports;
        exports = pyResult.exports;
        importRecords = pyResult.importRecords || [];
      } else if (['.js', '.ts', '.jsx', '.tsx'].includes(ext)) {
        ({ imports, exports, importRecords, exportRecords } = this.parseJavaScript(content));
      }

      // Resolve relative imports to absolute paths
      const resolvedImportRecords = (importRecords.length > 0 ? importRecords : imports.map((source) => createImportRecord(source)))
        .map((record) => {
          const resolved = this.resolveImport(filePath, record.source, ext);
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
      });

    } catch (e) {
      // 单个文件分析失败不应阻塞整个依赖图构建，记录日志后继续
      console.error(`[DepGraph] Failed to analyze ${filePath}:`, e.message);
    }
  }

  async parsePythonAST(content) {
    return new Promise((resolve) => {
      // Find Python executable
      const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
      const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'python_ast_parser.py');
      
      // Check if script exists first
      if (!fs.existsSync(scriptPath)) {
        resolve(null);
        return;
      }
      
      const python = spawn(pythonCmd, [scriptPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        timeout: 30000,
      });
      
      let output = '';
      let errorOutput = '';
      let killed = false;
      
      const timer = setTimeout(() => {
        killed = true;
        python.kill('SIGTERM');
      }, 30000);
      
      python.stdout.on('data', (data) => {
        output += data.toString('utf8');
        // Prevent memory exhaustion
        if (output.length > 10 * 1024 * 1024) {
          output = output.slice(0, 10 * 1024 * 1024) + '\n...[truncated]';
          python.stdout.destroy();
        }
      });
      
      python.stderr.on('data', (data) => {
        errorOutput += data.toString('utf8');
        if (errorOutput.length > 10 * 1024 * 1024) {
          errorOutput = errorOutput.slice(0, 10 * 1024 * 1024) + '\n...[truncated]';
          python.stderr.destroy();
        }
      });
      
      python.on('close', (code) => {
        clearTimeout(timer);
        if (killed || code !== 0) {
          if (process.env.DEBUG) {
            console.error(`[DepGraph] Python AST parse failed: exitCode=${code}, stderr=${errorOutput}`);
          }
          resolve(null);
          return;
        }
        try {
          const result = JSON.parse(output);
          resolve(result);
        } catch (e) {
          if (process.env.DEBUG) {
            console.error(`[DepGraph] Python AST JSON parse failed: ${e.message}`);
          }
          resolve(null);
        }
      });
      
      python.on('error', (err) => {
        clearTimeout(timer);
        if (process.env.DEBUG) {
          console.error(`[DepGraph] Python spawn failed: ${err.message}`);
        }
        resolve(null);
      });
      
      // Write content to stdin
      python.stdin.write(content, 'utf8');
      python.stdin.end();
    });
  }

  parsePythonWithRegex(content) {
    const imports = [];
    const importRecords = [];
    const exports = []; // Python doesn't have exports, but we track public symbols

    // Match: import X, from X import Y
    const importRegex = /^(?:from\s+(\S+)\s+import|import\s+(\S+))/gm;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      const module = match[1] || match[2];
      if (module) {
        imports.push(module);
        // For regex-based parsing, we don't have detailed import info
        importRecords.push(createImportRecord(module, { usesAllExports: true }));
      }
    }

    // Find public classes/functions (not starting with _)
    const classRegex = /^class\s+(\w+)/gm;
    const funcRegex = /^(?:async\s+)?def\s+(\w+)/gm;
    
    while ((match = classRegex.exec(content)) !== null) {
      if (!match[1].startsWith('_')) exports.push(match[1]);
    }
    while ((match = funcRegex.exec(content)) !== null) {
      if (!match[1].startsWith('_')) exports.push(match[1]);
    }

    return { imports, exports, importRecords };
  }

  async parsePython(content) {
    // Try AST parsing first
    const astResult = await this.parsePythonAST(content);
    if (astResult) {
      return {
        imports: uniqueNames(astResult.imports),
        exports: uniqueNames(astResult.exports),
        importRecords: astResult.importRecords.map((record) => 
          createImportRecord(record.source, {
            imported: record.imported,
            usesAllExports: record.usesAllExports
          })
        ),
      };
    }
    
    // Fallback to regex parsing
    return this.parsePythonWithRegex(content);
  }

  resolvePythonImport(fromFile, importPath) {
    const tryPythonCandidates = (basePath) => {
      const candidates = [
        `${basePath}.py`,
        path.join(basePath, '__init__.py'),
      ];
      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
      return null;
    };

    if (importPath.startsWith('.')) {
      const leadingDots = importPath.match(/^\.+/)[0].length;
      const remainder = importPath.slice(leadingDots);
      let currentDir = path.dirname(fromFile);

      for (let i = 1; i < leadingDots; i += 1) {
        currentDir = path.dirname(currentDir);
      }

      const basePath = remainder
        ? path.join(currentDir, ...remainder.split('.'))
        : currentDir;

      return tryPythonCandidates(basePath) || basePath;
    }

    const modulePath = importPath.split('.').join(path.sep);
    const searchRoots = [
      this.root,
      path.join(this.root, 'backend'),
      path.join(this.root, 'src'),
      path.join(this.root, 'app'),
    ];

    for (const root of searchRoots) {
      const resolved = tryPythonCandidates(path.join(root, modulePath));
      if (resolved) {
        return resolved;
      }
    }

    return null;
  }

  parseJavaScriptAST(content, filePath = '') {
    if (!babelParser) {
      return null;
    }

    const imports = [];
    const importRecords = [];
    const exportRecords = [];

    try {
      const ext = path.extname(filePath).toLowerCase();
      const isTS = ['.ts', '.tsx', '.mts', '.cts'].includes(ext);
      
      const ast = babelParser.parse(content, {
        sourceType: 'module',
        allowImportExportEverywhere: true,
        allowReturnOutsideFunction: true,
        plugins: [
          'jsx',
          'dynamicImport',
          'exportDefaultFrom',
          'exportNamespaceFrom',
          'importMeta',
          ...(isTS ? ['typescript'] : []),
        ],
      });

      function visitNode(node) {
        if (!node || typeof node !== 'object') return;

        // ImportDeclaration: import { x } from 'y'
        if (node.type === 'ImportDeclaration' && node.source?.value) {
          const source = node.source.value;
          imports.push(source);

          const imported = [];
          let usesAllExports = false;

          for (const spec of node.specifiers || []) {
            if (spec.type === 'ImportNamespaceSpecifier') {
              usesAllExports = true;
            } else if (spec.type === 'ImportDefaultSpecifier') {
              imported.push('default');
            } else if (spec.type === 'ImportSpecifier') {
              const name = spec.imported?.name || spec.imported?.value;
              if (name && name !== 'type') {
                imported.push(name);
              }
            }
          }

          importRecords.push(createImportRecord(source, { imported, usesAllExports }));
        }

        // ExportAllDeclaration: export * from 'y'
        if (node.type === 'ExportAllDeclaration' && node.source?.value) {
          exportRecords.push({ name: '*', unknown: true });
          imports.push(node.source.value);
          importRecords.push(createImportRecord(node.source.value, { usesAllExports: true }));
        }

        // ExportNamedDeclaration: export { x } from 'y' or export { x }
        if (node.type === 'ExportNamedDeclaration') {
          if (node.source?.value) {
            // Re-export: export { x } from 'y'
            imports.push(node.source.value);
            const exported = [];
            for (const spec of node.specifiers || []) {
              if (spec.type === 'ExportSpecifier') {
                const name = spec.local?.name || spec.local?.value;
                if (name && name !== 'type') {
                  exported.push(name);
                }
              }
            }
            for (const name of exported) {
              exportRecords.push({ name });
            }
            importRecords.push(createImportRecord(node.source.value, { 
              imported: exported, 
              usesAllExports: exported.length === 0 
            }));
          } else {
            // Local export: export { x }
            for (const spec of node.specifiers || []) {
              if (spec.type === 'ExportSpecifier') {
                const name = spec.local?.name || spec.local?.value;
                if (name) {
                  exportRecords.push({ name });
                }
              }
            }
          }

          // Export declaration: export function/class/const x
          if (node.declaration) {
            const decl = node.declaration;
            if (decl.id?.name) {
              exportRecords.push({ name: decl.id.name });
            }
            // Handle multiple exports: export const a = 1, b = 2
            if (decl.declarations) {
              for (const d of decl.declarations) {
                if (d.id?.name) {
                  exportRecords.push({ name: d.id.name });
                }
              }
            }
          }
        }

        // ExportDefaultDeclaration: export default x
        if (node.type === 'ExportDefaultDeclaration') {
          exportRecords.push({ name: 'default' });
        }

        // Dynamic import: import('x')
        if (node.type === 'ImportExpression' && node.source?.value) {
          imports.push(node.source.value);
          importRecords.push(createImportRecord(node.source.value, { usesAllExports: true }));
        }

        // CallExpression: require('x')
        if (node.type === 'CallExpression' && 
            node.callee?.type === 'Identifier' && 
            node.callee.name === 'require' &&
            node.arguments?.[0]?.value) {
          const source = node.arguments[0].value;
          imports.push(source);

          // Check if it's destructured: const { x } = require('y')
          let imported = [];
          // We can't easily track the parent here, so mark as usesAllExports
          importRecords.push(createImportRecord(source, { usesAllExports: true }));
        }

        // Recurse
        for (const key of Object.keys(node)) {
          if (key === 'type' || key === 'loc' || key === 'start' || key === 'end') continue;
          const child = node[key];
          if (Array.isArray(child)) {
            for (const c of child) visitNode(c);
          } else if (child && typeof child === 'object') {
            visitNode(child);
          }
        }
      }

      visitNode(ast);

      const exports = uniqueNames(exportRecords.filter((r) => !r.unknown).map((r) => r.name));
      return {
        imports: uniqueNames(imports),
        exports,
        importRecords,
        exportRecords,
      };
    } catch (e) {
      // AST parse failed, return null to fallback to regex
      if (process.env.DEBUG) {
        console.error(`[DepGraph] AST parse failed for ${filePath}:`, e.message);
      }
      return null;
    }
  }

  parseJavaScript(content, filePath = '') {
    // Try AST parsing first if available
    if (babelParser) {
      const astResult = this.parseJavaScriptAST(content, filePath);
      if (astResult) {
        return astResult;
      }
    }

    const imports = [];
    const importRecords = [];
    const exportRecords = [];

    const importFromRegex = /import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
    let match;
    while ((match = importFromRegex.exec(content)) !== null) {
      const clause = match[1].trim();
      const source = match[2];
      imports.push(source);

      if (clause.startsWith('* as ')) {
        importRecords.push(createImportRecord(source, { usesAllExports: true }));
        continue;
      }

      const imported = [];
      let usesAllExports = false;
      const namedMatch = clause.match(/\{([^}]*)\}/);
      if (namedMatch) {
        imported.push(...parseNamedBindings(namedMatch[1]));
      }

      const withoutNamed = clause.replace(/\{[^}]*\}/, '').split(',').map((part) => part.trim()).filter(Boolean);
      for (const part of withoutNamed) {
        if (!part) continue;
        if (part.startsWith('* as ')) {
          usesAllExports = true;
        } else {
          imported.push('default');
        }
      }

      importRecords.push(createImportRecord(source, { imported, usesAllExports }));
    }

    const sideEffectImportRegex = /import\s+['"]([^'"]+)['"]/g;
    while ((match = sideEffectImportRegex.exec(content)) !== null) {
      const source = match[1];
      imports.push(source);
      importRecords.push(createImportRecord(source, { usesAllExports: true }));
    }

    const destructuredRequireRegex = /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = destructuredRequireRegex.exec(content)) !== null) {
      const imported = parseNamedBindings(match[1]);
      const source = match[2];
      imports.push(source);
      importRecords.push(createImportRecord(source, { imported }));
    }

    const requireRegex = /(?:const|let|var)\s+[\w$]+\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)|require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = requireRegex.exec(content)) !== null) {
      const source = match[1] || match[2];
      imports.push(source);
      importRecords.push(createImportRecord(source, { usesAllExports: true }));
    }

    const dynamicImportRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = dynamicImportRegex.exec(content)) !== null) {
      const source = match[1];
      imports.push(source);
      importRecords.push(createImportRecord(source, { usesAllExports: true }));
    }

    const namedReExportRegex = /export\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
    while ((match = namedReExportRegex.exec(content)) !== null) {
      const exportedNames = match[1]
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
          const withoutType = part.replace(/^type\s+/, '').trim();
          const segments = withoutType.split(/\s+as\s+/i);
          return normalizeImportedName(segments[1] || segments[0]);
        })
        .filter(Boolean);
      for (const name of exportedNames) {
        exportRecords.push({ name });
      }
    }

    const exportAllRegex = /export\s+\*\s+from\s+['"]([^'"]+)['"]/g;
    while ((match = exportAllRegex.exec(content)) !== null) {
      exportRecords.push({ name: '*', unknown: true });
    }

    const namedExportRegex = /export\s*\{([^}]*)\}(?!\s*from)/g;
    while ((match = namedExportRegex.exec(content)) !== null) {
      const exportedNames = match[1]
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
          const withoutType = part.replace(/^type\s+/, '').trim();
          const segments = withoutType.split(/\s+as\s+/i);
          return normalizeImportedName(segments[1] || segments[0]);
        })
        .filter(Boolean);
      for (const name of exportedNames) {
        exportRecords.push({ name });
      }
    }

    const declarationExportRegex = /export\s+(?:async\s+)?(?:function|class|const|let|var)\s+(\w+)/g;
    while ((match = declarationExportRegex.exec(content)) !== null) {
      exportRecords.push({ name: match[1] });
    }

    const defaultNamedRegex = /export\s+default\s+(?:async\s+)?(?:function|class)\s+(\w+)/g;
    while ((match = defaultNamedRegex.exec(content)) !== null) {
      exportRecords.push({ name: 'default' });
    }
    if (/export\s+default\s+(?!async\s+function\s+\w+|function\s+\w+|class\s+\w+)/.test(content)) {
      exportRecords.push({ name: 'default' });
    }

    const exports = uniqueNames(exportRecords.filter((record) => !record.unknown).map((record) => record.name));
    return {
      imports: uniqueNames(imports),
      exports,
      importRecords,
      exportRecords,
    };
  }

  resolveJavaScriptImport(fromFile, importPath) {
    // Skip node_modules and built-ins
    if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
      return null;
    }

    const fromDir = path.dirname(fromFile);
    const resolvedBase = importPath.startsWith('.')
      ? path.resolve(fromDir, importPath)
      : importPath;

    const sourceExt = path.extname(fromFile).toLowerCase();
    const importExt = path.extname(importPath).toLowerCase();
    const isTypeScriptSource = ['.ts', '.tsx', '.mts', '.cts'].includes(sourceExt);

    const candidates = new Set();
    const addCandidate = (candidate) => {
      if (candidate) candidates.add(candidate);
    };

    addCandidate(resolvedBase);

    // TypeScript ESM commonly imports ./x.js from ./x.ts source.
    if (isTypeScriptSource && ['.js', '.mjs', '.cjs'].includes(importExt)) {
      const withoutImportExt = resolvedBase.slice(0, -importExt.length);
      addCandidate(`${withoutImportExt}.ts`);
      addCandidate(`${withoutImportExt}.tsx`);
      addCandidate(`${withoutImportExt}.mts`);
      addCandidate(`${withoutImportExt}.cts`);
      addCandidate(path.join(withoutImportExt, 'index.ts'));
      addCandidate(path.join(withoutImportExt, 'index.tsx'));
      addCandidate(path.join(withoutImportExt, 'index.mts'));
      addCandidate(path.join(withoutImportExt, 'index.cts'));
    }

    if (!importExt) {
      addCandidate(`${resolvedBase}.js`);
      addCandidate(`${resolvedBase}.jsx`);
      addCandidate(`${resolvedBase}.ts`);
      addCandidate(`${resolvedBase}.tsx`);
      addCandidate(`${resolvedBase}.mjs`);
      addCandidate(`${resolvedBase}.cjs`);
      addCandidate(`${resolvedBase}.json`);
      addCandidate(`${resolvedBase}.css`);
      addCandidate(path.join(resolvedBase, 'index.js'));
      addCandidate(path.join(resolvedBase, 'index.jsx'));
      addCandidate(path.join(resolvedBase, 'index.ts'));
      addCandidate(path.join(resolvedBase, 'index.tsx'));
      addCandidate(path.join(resolvedBase, 'index.mjs'));
      addCandidate(path.join(resolvedBase, 'index.cjs'));
    }

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    return resolvedBase;
  }

  resolveImport(fromFile, importPath, ext) {
    if (ext === '.py') {
      return this.resolvePythonImport(fromFile, importPath);
    }

    return this.resolveJavaScriptImport(fromFile, importPath);
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
