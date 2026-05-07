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

function resolvePythonImport(fromFile, importPath, root) {
  const tryPythonCandidates = (basePath) => {
    const candidates = [
      `${basePath}.py`,
      path.join(basePath, '__init__.py'),
    ];
    for (const candidate of candidates) {
      if (cachedExistsSync(candidate)) {
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
    root,
    path.join(root, 'backend'),
    path.join(root, 'src'),
    path.join(root, 'app'),
  ];

  for (const searchRoot of searchRoots) {
    const resolved = tryPythonCandidates(path.join(searchRoot, modulePath));
    if (resolved) {
      return resolved;
    }
  }

  return null;
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

function resolveJavaScriptImport(fromFile, importPath, root) {
  if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
    // Try alias resolution for non-relative imports (e.g. @/, ~)
    const aliasResolved = _resolveAlias(importPath, root);
    if (aliasResolved) return aliasResolved;
    return null;
  }

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
    const stat = cachedStatSync(candidate);
    if (stat) {
      if (stat.isDirectory()) {
        // Skip directories; index files are added as separate candidates.
        continue;
      }
      return candidate;
    }
  }

  // Don't return a bare directory path as a resolved module.
  const baseStat = cachedStatSync(resolvedBase);
  if (baseStat && baseStat.isDirectory()) {
    return null;
  }
  return resolvedBase;
}

function resolveJavaImport(importPath, root) {
  if (!importPath || importPath.endsWith('.*')) {
    return null;
  }
  const relative = importPath.split('.').join(path.sep);
  const candidates = discoverJavaSourceRoots(root).map((r) => path.join(r, relative));

  for (const base of candidates) {
    for (const ext of ['.java', '.kt']) {
      const fullPath = `${base}${ext}`;
      if (cachedExistsSync(fullPath)) {
        return fullPath;
      }
    }
  }
  return null;
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
  if (importPath.startsWith('.')) {
    const fromDir = path.dirname(fromFile);
    const resolved = path.resolve(fromDir, importPath);
    if (cachedExistsSync(resolved)) return resolved;
    const resolvedGo = `${resolved}.go`;
    if (cachedExistsSync(resolvedGo)) return resolvedGo;
    return null;
  }

  const modulePath = readGoMod(root);
  if (!modulePath || !importPath.startsWith(modulePath)) {
    return null;
  }

  let relPath = importPath.slice(modulePath.length);
  if (relPath.startsWith('/')) relPath = relPath.slice(1);

  const targetDir = relPath ? path.join(root, relPath) : root;
  const targetDirStat = cachedStatSync(targetDir);
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
  if (importPath.startsWith('crate::')) {
    const modulePath = importPath.slice('crate::'.length);
    return resolveRustModulePath(modulePath, root);
  }

  if (importPath.startsWith('super::')) {
    const fromDir = path.dirname(fromFile);
    let baseDir = fromDir;
    let remaining = importPath;
    const srcRoot = path.join(root, 'src');

    while (remaining.startsWith('super::')) {
      remaining = remaining.slice('super::'.length);
      const parent = path.dirname(baseDir);
      if (parent === baseDir || !parent.startsWith(srcRoot)) {
        return null;
      }
      baseDir = parent;
    }

    if (!remaining) return null;
    return resolveRustModulePath(remaining, root, baseDir);
  }

  return null;
}

function resolveImport(fromFile, importPath, ext, root) {
  if (!importPath) return null;
  if (ext === '.py') {
    return resolvePythonImport(fromFile, importPath, root);
  }
  if (ext === '.java' || ext === '.kt') {
    return resolveJavaImport(importPath, root);
  }
  if (ext === '.go') {
    return resolveGoImport(fromFile, importPath, root);
  }
  if (ext === '.rs') {
    return resolveRustImport(fromFile, importPath, root);
  }

  return resolveJavaScriptImport(fromFile, importPath, root);
}

module.exports = {
  resolveImport,
  resolveJavaImport,
  clearResolverCaches,
};
