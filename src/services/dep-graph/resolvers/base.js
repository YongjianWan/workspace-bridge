const fs = require('fs');
const path = require('path');
const { LIMITS } = require('../../../config/constants');

const RESOLVER_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css', '.vue'];
const TS_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts'];
const JS_IMPORT_EXTENSIONS = ['.js', '.mjs', '.cjs'];
const INDEX_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'];
const JAVA_SOURCE_ROOTS = ['src/main/java', 'src/test/java', 'src/main/kotlin', 'src/test/kotlin'];

const _javaSourceRootsCache = new Map(); // root -> string[]
const _statCache = new Map();
const _tsconfigPathsCache = new Map(); // root -> { paths, mtime }
const _resolverCache = new Map();
const _goModCache = new Map(); // root -> { modulePath, mtime }

function clearResolverCaches() {
  _statCache.clear();
  _resolverCache.clear();
  _javaSourceRootsCache.clear();
  _tsconfigPathsCache.clear();
  _goModCache.clear();
}

function _touchCache(map, key) {
  if (map.has(key)) {
    const value = map.get(key);
    map.delete(key);
    map.set(key, value);
  }
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
    _touchCache(_statCache, filePath);
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

  try {
    const content = fs.readFileSync(goModPath, 'utf8');
    const match = content.match(/^module\s+(\S+)/m);
    const modulePath = match ? match[1] : null;
    _goModCache.set(root, { modulePath, mtime: currentMtime });
    return modulePath;
  } catch {
    return null;
  }
}

function _readTsconfigPaths(root) {
  const tsconfigPath = path.join(root, 'tsconfig.json');
  const jsconfigPath = path.join(root, 'jsconfig.json');
  const configPath = cachedExistsSync(tsconfigPath) ? tsconfigPath : (cachedExistsSync(jsconfigPath) ? jsconfigPath : null);
  if (!configPath) return null;

  try {
    const mtime = fs.statSync(configPath).mtimeMs;
    const cached = _tsconfigPathsCache.get(configPath);
    if (cached && cached.mtime === mtime) return cached.paths;

    const { stripBOM } = require('../../../utils/sanitize');
    const content = fs.readFileSync(configPath, 'utf8');
    const cleaned = stripBOM(content)
      .replace(/("([^"\\]|\\.)*")|\/\*[\s\S]*?\*\/|(?:\s|^)\/\/[^\n]*/g, (m, stringLiteral) => {
        if (stringLiteral) return stringLiteral;
        return '';
      })
      .replace(/,\s*([\]}])/g, '$1');
    const parsed = JSON.parse(cleaned);
    const paths = parsed?.compilerOptions?.paths || null;
    const baseUrl = parsed?.compilerOptions?.baseUrl || '.';
    const result = paths ? { paths, baseUrl } : null;
    _tsconfigPathsCache.set(configPath, { paths: result, mtime });
    return result;
  } catch {
    return null;
  }
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

module.exports = {
  RESOLVER_EXTENSIONS,
  TS_EXTENSIONS,
  JS_IMPORT_EXTENSIONS,
  INDEX_EXTENSIONS,
  _resolverCache,
  clearResolverCaches,
  cachedStatSync,
  cachedExistsSync,
  discoverJavaSourceRoots,
  readGoMod,
  _readTsconfigPaths,
  _tryResolveWithExtensions,
};
