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
const _packageDepsCache = new Map(); // root -> { names: Set<string>, mtime }
const _cargoDepsCache = new Map(); // root -> { names: Set<string>, mtime }

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

function clearResolverCaches() {
  _statCache.clear();
  _resolverCache.clear();
  _javaSourceRootsCache.clear();
  _tsconfigPathsCache.clear();
  _goModCache.clear();
  _packageDepsCache.clear();
  _cargoDepsCache.clear();
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
  let stat;
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
  let currentMtime;
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

/**
 * Read every declared package name from the root package.json (all four
 * dependency fields). mtime-cached, same shape as readGoMod.
 * @param {string} root
 * @returns {Set<string>|null} null when there is no readable package.json
 */
function readPackageDeps(root) {
  const pkgPath = path.join(root, 'package.json');
  let currentMtime;
  try {
    currentMtime = fs.statSync(pkgPath).mtimeMs;
  } catch {
    _packageDepsCache.delete(root);
    return null;
  }

  const cached = _packageDepsCache.get(root);
  if (cached && cached.mtime === currentMtime) {
    return cached.names;
  }

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const names = new Set();
    for (const field of DEPENDENCY_FIELDS) {
      for (const name of Object.keys(pkg[field] || {})) names.add(name);
    }
    _packageDepsCache.set(root, { names, mtime: currentMtime });
    return names;
  } catch {
    return null;
  }
}

/**
 * Crate names declared as external dependencies in the root Cargo.toml.
 *
 * Path dependencies are deliberately excluded: their sources live inside the
 * workspace and are in the graph, so resolving them is legitimate work rather
 * than a guess at somebody else's package.
 *
 * @param {string} root
 * @returns {Set<string>|null} names normalized to their path form (hyphens → underscores)
 */
function readCargoDeps(root) {
  const cargoPath = path.join(root, 'Cargo.toml');
  let currentMtime;
  try {
    currentMtime = fs.statSync(cargoPath).mtimeMs;
  } catch {
    _cargoDepsCache.delete(root);
    return null;
  }

  const cached = _cargoDepsCache.get(root);
  if (cached && cached.mtime === currentMtime) {
    return cached.names;
  }

  try {
    const content = fs.readFileSync(cargoPath, 'utf8');
    const names = new Set();
    const add = (name) => {
      const trimmed = String(name).trim().replace(/^["']|["']$/g, '');
      if (trimmed) names.add(trimmed.replace(/-/g, '_'));
    };

    let inDependencySection = false;
    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim();
      if (line.startsWith('[')) {
        const header = line.slice(1, line.indexOf(']') === -1 ? line.length : line.indexOf(']')).trim();
        // [dependencies] / [dev-dependencies] / [target.'cfg(unix)'.dependencies]
        inDependencySection = /(^|\.)(dev-|build-)?dependencies$/.test(header);
        // [dependencies.serde] declares `serde` in the header itself
        const sub = header.match(/(?:^|\.)(?:dev-|build-)?dependencies\.([A-Za-z0-9_-]+)$/);
        if (sub) add(sub[1]);
        continue;
      }
      if (!inDependencySection || !line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      // A path dependency is a workspace member, not a foreign package.
      if (/\bpath\s*=/.test(line.slice(eq + 1))) continue;
      add(line.slice(0, eq));
    }

    _cargoDepsCache.set(root, { names, mtime: currentMtime });
    return names;
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
  readPackageDeps,
  readCargoDeps,
  _readTsconfigPaths,
  _tryResolveWithExtensions,
};
