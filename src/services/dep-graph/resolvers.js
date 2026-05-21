const fs = require('fs');
const path = require('path');
const { LIMITS } = require('../../config/constants');

const RESOLVER_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css', '.vue'];
const TS_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts'];
const JS_IMPORT_EXTENSIONS = ['.js', '.mjs', '.cjs'];
const INDEX_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'];
const JAVA_SOURCE_ROOTS = ['src/main/java', 'src/test/java', 'src/main/kotlin', 'src/test/kotlin'];

const _javaSourceRootsCache = new Map(); // root -> string[]

// LRU-ish stat cache to avoid repeated sync I/O during bulk resolution.
// Large repos may trigger 10k+ existence checks; caching cuts this by 80%+.
const _statCache = new Map();

function clearResolverCaches() {
  _statCache.clear();
  _resolverCache.clear();
}

function _trimCache(map, maxSize) {
  if (map.size <= maxSize) return;
  const keysToDelete = map.size - maxSize;
  let deleted = 0;
  for (const key of map.keys()) {
    if (deleted >= keysToDelete) break;
    map.delete(key);
    deleted += 1;
  }
}

function cachedStatSync(filePath) {
  if (_statCache.has(filePath)) {
    return _statCache.get(filePath);
  }
  let stat = null;
  try {
    stat = fs.statSync(filePath);
  } catch {
    stat = null;
  }
  _statCache.set(filePath, stat);
  _trimCache(_statCache, LIMITS.RESOLVER_STAT_CACHE_MAX);
  return stat;
}

function cachedExistsSync(filePath) {
  return cachedStatSync(filePath) !== null;
}

function discoverJavaSourceRoots(root) {
  if (_javaSourceRootsCache.has(root)) {
    return _javaSourceRootsCache.get(root);
  }

  const roots = [root, path.join(root, 'src'), path.join(root, 'app')];

  // Single-module projects
  for (const srcDir of JAVA_SOURCE_ROOTS) {
    const candidate = path.join(root, srcDir);
    if (cachedExistsSync(candidate)) {
      roots.push(candidate);
    }
  }

  // Multi-module projects
  try {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const sub = path.join(root, entry.name);
      for (const srcDir of JAVA_SOURCE_ROOTS) {
        const candidate = path.join(sub, srcDir);
        if (cachedExistsSync(candidate)) {
          roots.push(candidate);
        }
      }
    }
  } catch (e) {
    // root unreadable, ignore
  }

  _javaSourceRootsCache.set(root, roots);
  return roots;
}

function _tryResolveWithExtensions(basePath) {
  const candidates = [];
  for (const ext of RESOLVER_EXTENSIONS) {
    candidates.push(`${basePath}${ext}`);
  }
  for (const ext of INDEX_EXTENSIONS) {
    candidates.push(path.join(basePath, `index${ext}`));
  }
  for (const candidate of candidates) {
    const stat = cachedStatSync(candidate);
    if (stat && !stat.isDirectory()) {
      return candidate;
    }
  }
  return null;
}

const _tsconfigPathsCache = new Map(); // root -> { paths, mtime }

// O7: Cache resolver instances per extension to avoid recreating the composed
// function on every resolveImport call. Large repos may trigger 10k+ calls.
const _resolverCache = new Map();

function _readTsconfigPaths(root) {
  const tsconfigPath = path.join(root, 'tsconfig.json');
  const jsconfigPath = path.join(root, 'jsconfig.json');
  const configPath = cachedExistsSync(tsconfigPath) ? tsconfigPath : (cachedExistsSync(jsconfigPath) ? jsconfigPath : null);
  if (!configPath) return null;

  try {
    const mtime = fs.statSync(configPath).mtimeMs;
    const cached = _tsconfigPathsCache.get(configPath);
    if (cached && cached.mtime === mtime) return cached.paths;

    const content = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(content);
    const paths = parsed?.compilerOptions?.paths || null;
    const baseUrl = parsed?.compilerOptions?.baseUrl || '.';
    const result = paths ? { paths, baseUrl } : null;
    _tsconfigPathsCache.set(configPath, { paths: result, mtime });
    return result;
  } catch {
    return null;
  }
}

function _resolveAlias(importPath, root) {
  if (!root) return null;
  const tsconfig = _readTsconfigPaths(root);
  if (tsconfig?.paths) {
    for (const [key, values] of Object.entries(tsconfig.paths)) {
      const prefix = key.replace(/\*$/, '');
      if (importPath.startsWith(prefix)) {
        const suffix = importPath.slice(prefix.length);
        for (const mapped of values) {
          const mappedPrefix = mapped.replace(/\*$/, '');
          const resolved = path.join(root, tsconfig.baseUrl, mappedPrefix + suffix);
          const found = _tryResolveWithExtensions(resolved) || resolved;
          if (cachedExistsSync(found)) return found;
        }
      }
    }
  }

  // Fallback: common Vite/Webpack aliases when no tsconfig/jsconfig paths
  if (importPath.startsWith('@/')) {
    const resolved = path.join(root, 'src', importPath.slice(2));
    return _tryResolveWithExtensions(resolved) || resolved;
  }
  if (importPath.startsWith('~/')) {
    const resolved = path.join(root, importPath.slice(2));
    return _tryResolveWithExtensions(resolved) || resolved;
  }

  return null;
}

// ============================================================================
// Resolver Strategy Chain — inspired by GitNexus import-resolvers pattern.
// Each strategy: (importPath, fromFile, ctx) => string | null
// First non-null result wins. Null means "let the next strategy try".
// ============================================================================

/**
 * Build a resolution context shared across strategies for a single resolveImport call.
 * @param {string} root
 * @returns {object}
 */
function _buildContext(root, symbolRegistry = null) {
  return {
    root,
    cachedExistsSync,
    cachedStatSync,
    tryResolveWithExtensions: _tryResolveWithExtensions,
    discoverJavaSourceRoots,
    readGoMod,
    symbolRegistry,
  };
}

/** @type {Map<string, ResolverStrategy[]>} */
const RESOLVER_CONFIGS = new Map();

/**
 * Register a resolver config for a file extension.
 * @param {string} ext — file extension (e.g. '.py')
 * @param {ResolverStrategy[]} strategies — ordered strategy chain
 */
function registerResolverConfig(ext, strategies) {
  RESOLVER_CONFIGS.set(ext, strategies);
  _resolverCache.delete(ext);
}

/**
 * Create a composed resolver from an ordered strategy list.
 * Mirrors GitNexus `createImportResolver` factory.
 * @param {ResolverStrategy[]} strategies
 * @returns {(importPath: string, fromFile: string, ctx: object) => string | null}
 */
function createResolver(strategies) {
  return (importPath, fromFile, ctx) => {
    for (const strategy of strategies) {
      const result = strategy(importPath, fromFile, ctx);
      if (result !== null) return result;
    }
    return null;
  };
}

// ---------------------------------------------------------------------------
// Strategy: Alias resolution (JS/TS/Vite/Webpack)
// ---------------------------------------------------------------------------
function tryAlias(importPath, _fromFile, ctx) {
  if (importPath.startsWith('.') || importPath.startsWith('/')) return null;
  return _resolveAlias(importPath, ctx.root);
}

// ---------------------------------------------------------------------------
// Strategy: Relative path with extension fallback (JS/TS/Vue/Svelte)
// ---------------------------------------------------------------------------
function tryRelativeWithExtensions(importPath, fromFile, ctx) {
  if (!importPath.startsWith('.') && !importPath.startsWith('/')) return null;

  const fromDir = path.dirname(fromFile);
  const resolvedBase = importPath.startsWith('.')
    ? path.resolve(fromDir, importPath)
    : importPath;

  const sourceExt = path.extname(fromFile).toLowerCase();
  const importExt = path.extname(importPath).toLowerCase();
  const isTypeScriptSource = TS_EXTENSIONS.includes(sourceExt);

  const candidates = new Set();
  const addCandidate = (candidate) => {
    if (candidate) candidates.add(candidate);
  };

  addCandidate(resolvedBase);

  if (isTypeScriptSource && JS_IMPORT_EXTENSIONS.includes(importExt)) {
    const withoutImportExt = resolvedBase.slice(0, -importExt.length);
    for (const ext of TS_EXTENSIONS) {
      addCandidate(`${withoutImportExt}${ext}`);
    }
    for (const ext of TS_EXTENSIONS) {
      addCandidate(path.join(withoutImportExt, `index${ext}`));
    }
  }

  if (!importExt) {
    for (const ext of RESOLVER_EXTENSIONS) {
      addCandidate(`${resolvedBase}${ext}`);
    }
    for (const ext of INDEX_EXTENSIONS) {
      addCandidate(path.join(resolvedBase, `index${ext}`));
    }
  }

  for (const candidate of candidates) {
    const stat = ctx.cachedStatSync(candidate);
    if (stat) {
      if (stat.isDirectory()) {
        continue;
      }
      return candidate;
    }
  }

  const baseStat = ctx.cachedStatSync(resolvedBase);
  if (baseStat && baseStat.isDirectory()) {
    return null;
  }
  return resolvedBase;
}

// ---------------------------------------------------------------------------
// Strategy: Python relative import
// ---------------------------------------------------------------------------
function tryPythonRelative(importPath, fromFile, ctx) {
  if (!importPath.startsWith('.')) return null;

  const tryPythonCandidates = (basePath) => {
    const candidates = [
      `${basePath}.py`,
      path.join(basePath, '__init__.py'),
    ];
    for (const candidate of candidates) {
      if (ctx.cachedExistsSync(candidate)) {
        return candidate;
      }
    }
    return null;
  };

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

// ---------------------------------------------------------------------------
// Strategy: Python absolute import
// ---------------------------------------------------------------------------
function tryPythonAbsolute(importPath, _fromFile, ctx) {
  if (importPath.startsWith('.')) return null;

  const tryPythonCandidates = (basePath) => {
    const candidates = [
      `${basePath}.py`,
      path.join(basePath, '__init__.py'),
    ];
    for (const candidate of candidates) {
      if (ctx.cachedExistsSync(candidate)) {
        return candidate;
      }
    }
    return null;
  };

  const modulePath = importPath.split('.').join(path.sep);
  const searchRoots = [
    ctx.root,
    path.join(ctx.root, 'backend'),
    path.join(ctx.root, 'src'),
    path.join(ctx.root, 'app'),
  ];

  for (const searchRoot of searchRoots) {
    const resolved = tryPythonCandidates(path.join(searchRoot, modulePath));
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Strategy: Java / Kotlin package resolution
// ---------------------------------------------------------------------------
function tryJava(importPath, _fromFile, ctx) {
  if (!importPath || importPath.endsWith('.*')) {
    return null;
  }
  const relative = importPath.split('.').join(path.sep);
  const candidates = ctx.discoverJavaSourceRoots(ctx.root).map((r) => path.join(r, relative));

  for (const base of candidates) {
    for (const ext of ['.java', '.kt']) {
      const fullPath = `${base}${ext}`;
      if (ctx.cachedExistsSync(fullPath)) {
        return fullPath;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Strategy: Go relative import
// ---------------------------------------------------------------------------
function tryGoRelative(importPath, fromFile, ctx) {
  if (!importPath.startsWith('.')) return null;

  const fromDir = path.dirname(fromFile);
  const resolved = path.resolve(fromDir, importPath);
  if (ctx.cachedExistsSync(resolved)) return resolved;
  const resolvedGo = `${resolved}.go`;
  if (ctx.cachedExistsSync(resolvedGo)) return resolvedGo;
  return null;
}

// ---------------------------------------------------------------------------
// Strategy: Go module import
// ---------------------------------------------------------------------------
function tryGoModule(importPath, _fromFile, ctx) {
  if (importPath.startsWith('.')) return null;

  const modulePath = ctx.readGoMod(ctx.root);
  if (!modulePath || !importPath.startsWith(modulePath)) {
    return null;
  }

  let relPath = importPath.slice(modulePath.length);
  if (relPath.startsWith('/')) relPath = relPath.slice(1);

  const targetDir = relPath ? path.join(ctx.root, relPath) : ctx.root;
  const targetDirStat = ctx.cachedStatSync(targetDir);
  if (!targetDirStat || !targetDirStat.isDirectory()) return null;

  try {
    const entries = fs.readdirSync(targetDir).sort();
    const goFile = entries.find((f) => f.endsWith('.go') && !f.endsWith('_test.go'));
    if (goFile) {
      return path.join(targetDir, goFile);
    }
  } catch {
    // ignore
  }

  return null;
}

// ---------------------------------------------------------------------------
// Strategy: Rust crate:: resolution
// ---------------------------------------------------------------------------
function tryRustCrate(importPath, _fromFile, ctx) {
  if (!importPath.startsWith('crate::')) return null;
  const modulePath = importPath.slice('crate::'.length);
  return resolveRustModulePath(modulePath, ctx.root);
}

// ---------------------------------------------------------------------------
// Strategy: SymbolRegistry fallback
// Fallback when all heuristic string-matching strategies fail.
// Looks up the last segment of the import path as a symbol name in the
// workspace-wide SymbolRegistry. Only activates when a registry is provided.
// ---------------------------------------------------------------------------
function trySymbolTable(importPath, fromFile, ctx) {
  if (!ctx.symbolRegistry) return null;
  // Relative and absolute filesystem paths are out of scope for symbol lookup.
  if (importPath.startsWith('.') || importPath.startsWith('/')) return null;

  const symbolName = importPath.includes('.')
    ? importPath.split('.').pop()
    : importPath;
  if (!symbolName) return null;

  const fromDir = fromFile ? path.dirname(fromFile) : null;
  return ctx.symbolRegistry.lookupUnique(symbolName, fromDir);
}

// ---------------------------------------------------------------------------
// Strategy: Rust super:: resolution
// ---------------------------------------------------------------------------
function tryRustSuper(importPath, fromFile, ctx) {
  if (!importPath.startsWith('super::')) return null;

  const fromDir = path.dirname(fromFile);
  let baseDir = fromDir;
  let remaining = importPath;
  const srcRoot = path.join(ctx.root, 'src');

  while (remaining.startsWith('super::')) {
    remaining = remaining.slice('super::'.length);
    const parent = path.dirname(baseDir);
    if (parent === baseDir || !parent.startsWith(srcRoot)) {
      return null;
    }
    baseDir = parent;
  }

  if (!remaining) return null;
  return resolveRustModulePath(remaining, ctx.root, baseDir);
}

// ---------------------------------------------------------------------------
// Legacy helpers (kept for internal use and backward compat)
// ---------------------------------------------------------------------------

function resolvePythonImport(fromFile, importPath, root) {
  const ctx = _buildContext(root);
  const resolver = createResolver([tryPythonRelative, tryPythonAbsolute]);
  return resolver(importPath, fromFile, ctx);
}

function resolveJavaScriptImport(fromFile, importPath, root) {
  const ctx = _buildContext(root);
  const resolver = createResolver([tryAlias, tryRelativeWithExtensions]);
  return resolver(importPath, fromFile, ctx);
}

function resolveJavaImport(importPath, root) {
  const ctx = _buildContext(root);
  return tryJava(importPath, null, ctx);
}

const _goModCache = new Map(); // root -> { modulePath, mtime }

function readGoMod(root) {
  const goModPath = path.join(root, 'go.mod');
  let currentMtime = 0;
  try {
    currentMtime = fs.statSync(goModPath).mtimeMs;
  } catch {
    _goModCache.delete(root);
    return null;
  }

  const cached = _goModCache.get(root);
  if (cached && cached.mtime === currentMtime) {
    return cached.modulePath;
  }

  const content = fs.readFileSync(goModPath, 'utf8');
  const match = content.match(/^module\s+(\S+)/m);
  const modulePath = match ? match[1] : null;
  _goModCache.set(root, { modulePath, mtime: currentMtime });
  return modulePath;
}

function resolveGoImport(fromFile, importPath, root) {
  const ctx = _buildContext(root);
  const resolver = createResolver([tryGoRelative, tryGoModule]);
  return resolver(importPath, fromFile, ctx);
}

function resolveRustModulePath(modulePath, root, baseDir) {
  const segments = modulePath.split('::').filter(Boolean);
  if (segments.length === 0) return null;

  const searchBase = baseDir || path.join(root, 'src');

  for (let i = segments.length; i > 0; i--) {
    const subPath = segments.slice(0, i).join('/');
    const candidates = [
      path.join(searchBase, `${subPath}.rs`),
      path.join(searchBase, `${subPath}/mod.rs`),
    ];
    for (const candidate of candidates) {
      if (cachedExistsSync(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

function resolveRustImport(fromFile, importPath, root) {
  const ctx = _buildContext(root);
  const resolver = createResolver([tryRustCrate, tryRustSuper]);
  return resolver(importPath, fromFile, ctx);
}

// Register resolver configs for all supported extensions.
// Adding a new language requires exactly one line here.
registerResolverConfig('.py', [tryPythonRelative, tryPythonAbsolute, trySymbolTable]);
registerResolverConfig('.java', [tryJava, trySymbolTable]);
registerResolverConfig('.kt', [tryJava, trySymbolTable]);
registerResolverConfig('.go', [tryGoRelative, tryGoModule, trySymbolTable]);
registerResolverConfig('.rs', [tryRustCrate, tryRustSuper, trySymbolTable]);
registerResolverConfig('default', [tryAlias, tryRelativeWithExtensions, trySymbolTable]);

function resolveImport(fromFile, importPath, ext, root, symbolRegistry = null) {
  if (!importPath) return null;
  let resolver = _resolverCache.get(ext);
  if (!resolver) {
    const strategies = RESOLVER_CONFIGS.get(ext) || RESOLVER_CONFIGS.get('default');
    resolver = createResolver(strategies);
    _resolverCache.set(ext, resolver);
  }
  return resolver(importPath, fromFile, _buildContext(root, symbolRegistry));
}

module.exports = {
  resolveImport,
  resolveJavaImport,
  clearResolverCaches,
  cachedExistsSync,
  // Expose strategy internals for testing and future extension
  createResolver,
  registerResolverConfig,
  RESOLVER_CONFIGS,
  tryAlias,
  tryRelativeWithExtensions,
  tryPythonRelative,
  tryPythonAbsolute,
  tryJava,
  tryGoRelative,
  tryGoModule,
  tryRustCrate,
  tryRustSuper,
  trySymbolTable,
};
