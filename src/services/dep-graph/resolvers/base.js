const fs = require('fs');
const path = require('path');
const { LIMITS } = require('../../../config/constants');
const { normalizePathKey } = require('../../../utils/path');

const RESOLVER_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css', '.vue'];
const TS_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts'];
const JS_IMPORT_EXTENSIONS = ['.js', '.mjs', '.cjs'];
const INDEX_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'];
const JAVA_SOURCE_ROOTS = ['src/main/java', 'src/test/java', 'src/main/kotlin', 'src/test/kotlin'];
// KMP / non-standard Gradle layouts put sources at src/<sourceSet>/<leaf> —
// the sourceSet name is arbitrary (commonJvmAndroid, jvmTest, desktopMain…),
// so the scan keys on the leaf names, never the middle component.
const SOURCESET_LEAVES = ['kotlin', 'java'];
// Container-dir descent skips dependency/build noise — a fixture under
// node_modules or generated output under build/ is not a source root.
// Hidden dirs are skipped too: no legitimate JVM module lives in a dotdir.
const CONTAINER_DESCENT_SKIP = new Set(['node_modules', 'build', 'dist', 'out', 'target']);

const _javaSourceRootsCache = new Map(); // root -> string[]
const _statCache = new Map();
const _tsconfigPathsCache = new Map(); // root -> { paths, mtime }
const _resolverCache = new Map();
const _goModCache = new Map(); // root -> { modulePath, mtime }
const _packageDepsCache = new Map(); // root -> { names: Set<string>, mtime }
const _packageDirChainCache = new Map(); // fromDir\nroot -> string[] manifest dirs, nearest first
const _cargoDepsCache = new Map(); // root -> { names: Set<string>, mtime }
const _cargoNameCache = new Map(); // crateRoot -> { crateName, mtime }
const _pythonDepsCache = new Map(); // root -> { names: Set<string>, stamp }
const _jvmDepsCache = new Map(); // root -> { prefixes: Set<string>, stamp }
const _cargoCrateRootCache = new Map(); // dir -> nearest ancestor dir containing Cargo.toml

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

function clearResolverCaches() {
  _statCache.clear();
  _resolverCache.clear();
  _javaSourceRootsCache.clear();
  _tsconfigPathsCache.clear();
  _goModCache.clear();
  _packageDepsCache.clear();
  _packageDirChainCache.clear();
  _cargoDepsCache.clear();
  _cargoNameCache.clear();
  _pythonDepsCache.clear();
  _jvmDepsCache.clear();
  _cargoCrateRootCache.clear();
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
  collectModuleRoots(root, roots);

  // Multi-module projects: scan each first-level subdir, and one level
  // deeper for container dirs (okhttp's samples/ has no src of its own but
  // holds 8 sibling modules, each with src/main/kotlin — stopping at root+1
  // pushed those edges to symbol-table guessing even with class == file
  // name). Dependency/build noise and hidden dirs are not descended into.
  try {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const sub = path.join(root, entry.name);
      collectModuleRoots(sub, roots);
      if (CONTAINER_DESCENT_SKIP.has(entry.name) || entry.name.startsWith('.')) continue;
      let grandchildren;
      try {
        grandchildren = fs.readdirSync(sub, { withFileTypes: true });
      } catch {
        continue; // sub unreadable, ignore
      }
      for (const grand of grandchildren) {
        if (!grand.isDirectory()) continue;
        collectModuleRoots(path.join(sub, grand.name), roots);
      }
    }
  } catch (e) {
    // root unreadable, ignore
  }

  // The standard-layout and sourceSet scans overlap (src/main/java is both a
  // JAVA_SOURCE_ROOT and a <sourceSet>/<leaf> hit) — dedupe or every tryJava
  // candidate gets probed twice.
  const deduped = [...new Set(roots)];
  _javaSourceRootsCache.set(root, deduped);
  return deduped;
}

// One module dir → its standard-layout roots plus its sourceSet roots.
// Shared by the single-module scan and both depths of the multi-module scan.
function collectModuleRoots(dir, roots) {
  for (const srcDir of JAVA_SOURCE_ROOTS) {
    const candidate = path.join(dir, srcDir);
    if (cachedExistsSync(candidate)) {
      roots.push(candidate);
    }
  }
  collectSourceSetRoots(dir, roots);
}

// L2-14: <base>/src/<sourceSet>/{kotlin,java} — one level deeper than the
// Maven standard, arbitrary sourceSet name. okhttp's main sources live at
// okhttp/src/commonJvmAndroid/kotlin, which the standard list cannot see.
function collectSourceSetRoots(base, roots) {
  const srcDir = path.join(base, 'src');
  if (!cachedExistsSync(srcDir)) return;
  let sourceSets;
  try {
    sourceSets = fs.readdirSync(srcDir, { withFileTypes: true });
  } catch {
    return; // src unreadable, ignore
  }
  for (const ss of sourceSets) {
    if (!ss.isDirectory()) continue;
    for (const leaf of SOURCESET_LEAVES) {
      const candidate = path.join(srcDir, ss.name, leaf);
      if (cachedExistsSync(candidate)) {
        roots.push(candidate);
      }
    }
  }
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
 * Directories holding a package.json from fromDir up to (and including) the
 * workspace root, nearest first — the manifest chain node resolution consults
 * for a file at fromDir. Monorepo sub-packages declare their own deps, so a
 * gate that reads only the root manifest miscounts every sub-package dep as
 * an unclaimed drop (L2-11 gap A: zod's @rollup/plugin-* lived only in
 * packages/treeshake/package.json — 80 false drops across 42 files).
 * A fromDir outside root falls back to the root manifest alone.
 * @param {string|null} fromDir
 * @param {string} root
 * @returns {string[]} manifest dirs, nearest first
 */
function packageManifestChain(fromDir, root) {
  if (!root) return [];
  // Compare in normalizePathKey space, RETURN platform-native original-case
  // dirs — the same split findCargoCrateRoot makes, for the same reason.
  // Callers hand us paths in either shape and on Windows those differ in case
  // and separators, so raw-string containment would silently truncate the
  // chain to the root manifest alone; but consumers path.join and cache-key
  // against file-index paths (native casing), so a normalized return value
  // breaks their arithmetic the other way.
  const nativeRoot = path.resolve(root);
  const rootNorm = normalizePathKey(nativeRoot);
  const start = fromDir ? path.resolve(fromDir) : nativeRoot;
  const key = `${normalizePathKey(start)}\n${rootNorm}`;
  const cached = _packageDirChainCache.get(key);
  if (cached) return cached;

  const chain = [];
  let dir = start;
  for (;;) {
    const dirNorm = normalizePathKey(dir);
    if (dirNorm !== rootNorm && !dirNorm.startsWith(rootNorm + '/')) break;
    if (cachedExistsSync(path.join(dir, 'package.json'))) chain.push(dir);
    if (dirNorm === rootNorm) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (chain.length === 0 && cachedExistsSync(path.join(nativeRoot, 'package.json'))) {
    chain.push(nativeRoot);
  }
  _packageDirChainCache.set(key, chain);
  return chain;
}

/**
 * Cargo's package-name → crate-name rule: hyphens become underscores. Shared
 * by the resolver (own-crate paths), the external gate, and readCargoDeps —
 * one home, not three copies of the same rule (L2-7: 重复即债务).
 */
function normalizeCrateName(name) {
  return String(name || '').trim().replace(/^["']|["']$/g, '').replace(/-/g, '_');
}

/**
 * The crate name of the crate rooted at crateRoot: `[lib] name` when explicit
 * (it is the crate name, not the package name), else `[package] name` with
 * Cargo's hyphen rule applied. mtime-cached, same shape as readGoMod.
 * @param {string} crateRoot directory containing Cargo.toml
 * @returns {string|null} normalized crate name
 */
function readCargoCrateName(crateRoot) {
  const cargoPath = path.join(crateRoot, 'Cargo.toml');
  let currentMtime;
  try {
    currentMtime = fs.statSync(cargoPath).mtimeMs;
  } catch {
    _cargoNameCache.delete(crateRoot);
    return null;
  }

  const cached = _cargoNameCache.get(crateRoot);
  if (cached && cached.mtime === currentMtime) {
    return cached.crateName;
  }

  try {
    const content = fs.readFileSync(cargoPath, 'utf8');
    let section = '';
    let packageName = null;
    let libName = null;
    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim();
      if (line.startsWith('[')) {
        section = line.slice(1, line.indexOf(']') === -1 ? line.length : line.indexOf(']')).trim();
        continue;
      }
      if (!line || line.startsWith('#')) continue;
      const m = line.match(/^name\s*=\s*["']([^"']+)["']/);
      if (!m) continue;
      if (section === 'package' && packageName === null) packageName = m[1];
      if (section === 'lib' && libName === null) libName = m[1];
    }
    const crateName = normalizeCrateName(libName || packageName) || null;
    _cargoNameCache.set(crateRoot, { crateName, mtime: currentMtime });
    return crateName;
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
      const trimmed = normalizeCrateName(name);
      if (trimmed) names.add(trimmed);
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

/**
 * Package names declared for a Python project: requirements.txt lines plus
 * pyproject.toml `[project] dependencies` / `[project.optional-dependencies]`
 * arrays and `[tool.poetry...dependencies]` tables. Both manifests are merged;
 * either one alone is enough. Names are PEP 503-normalized (lowercase, runs of
 * `-_.` collapse to `-`) so `tree-sitter` matches its import name
 * `tree_sitter`; a handful of famous package-name/import-name mismatches are
 * bridged by PYTHON_IMPORT_ALIASES.
 *
 * @param {string} root
 * @returns {Set<string>|null} null when neither manifest is readable
 */
const PYTHON_IMPORT_ALIASES = new Map([
  ['python-dotenv', 'dotenv'],
  ['pyyaml', 'yaml'],
  ['pillow', 'pil'],
  ['beautifulsoup4', 'bs4'],
  ['scikit-learn', 'sklearn'],
  ['opencv-python', 'cv2'],
]);

function _normalizePythonName(name) {
  return String(name).trim().toLowerCase().replace(/[-_.]+/g, '-');
}

function _pep508Name(requirement) {
  const match = String(requirement).trim().match(/^[A-Za-z0-9._-]+/);
  return match ? match[0] : null;
}

function readPythonDeps(root) {
  const reqPath = path.join(root, 'requirements.txt');
  const pyPath = path.join(root, 'pyproject.toml');
  const stampOf = (p) => {
    try {
      return fs.statSync(p).mtimeMs;
    } catch {
      return 0;
    }
  };
  const stamp = `${stampOf(reqPath)}:${stampOf(pyPath)}`;
  if (stamp === '0:0') {
    _pythonDepsCache.delete(root);
    return null;
  }

  const cached = _pythonDepsCache.get(root);
  if (cached && cached.stamp === stamp) {
    return cached.names;
  }

  const names = new Set();
  const add = (raw) => {
    const name = _pep508Name(raw);
    if (!name) return;
    const normalized = _normalizePythonName(name);
    if (!normalized || normalized === 'python') return;
    names.add(normalized);
    const alias = PYTHON_IMPORT_ALIASES.get(normalized);
    if (alias) names.add(alias);
  };

  try {
    if (stampOf(reqPath)) {
      for (const rawLine of fs.readFileSync(reqPath, 'utf8').split('\n')) {
        const line = rawLine.replace(/\s+#.*$/, '').trim();
        if (!line || line.startsWith('#') || line.startsWith('-')) continue;
        add(line.split(';')[0]); // drop environment markers
      }
    }
  } catch {
    // unreadable requirements.txt — pyproject may still carry the facts
  }

  try {
    if (stampOf(pyPath)) {
      let section = '';
      let collecting = false;
      for (const rawLine of fs.readFileSync(pyPath, 'utf8').split('\n')) {
        const line = rawLine.trim();
        const header = line.match(/^\[([^\]]+)\]/);
        if (header) {
          section = header[1].trim();
          collecting = false;
          continue;
        }
        if (section === 'project' || section === 'project.optional-dependencies') {
          if (/^[\w-]*\s*=\s*\[/.test(line)) collecting = true;
          if (collecting) {
            for (const m of line.matchAll(/["']([^"']+)["']/g)) add(m[1]);
            if (line.includes(']')) collecting = false;
            continue;
          }
        }
        if (/^tool\.poetry\.(group\.[\w-]+\.)?dependencies$/.test(section)) {
          const eq = line.indexOf('=');
          if (eq > 0) add(line.slice(0, eq));
        }
      }
    }
  } catch {
    // unreadable pyproject.toml — requirements.txt may still carry the facts
  }

  _pythonDepsCache.set(root, { names, stamp });
  return names;
}

/**
 * Third-party groupId prefixes declared by the root JVM manifests, merged
 * from three hand-rolled sources (no XML/TOML parser dependency, same
 * precedent as readCargoDeps):
 *
 *  - pom.xml: <groupId> inside <dependency> / <parent> blocks only. The
 *    project's own <groupId> is skipped — it names the workspace, and the
 *    gate's "workspace package finer than declared groupId" check already
 *    protects reactor modules, so including it would only add noise. XML
 *    comments are stripped first: a commented-out dependency declares nothing.
 *  - build.gradle / build.gradle.kts: literal "group:artifact:version"
 *    coordinates. `group = 'com.example'` has no colon and never matches —
 *    own-group exclusion falls out of the coordinate shape, not an if.
 *    Catalog references (libs.guava) carry no groupId; the TOML covers those.
 *  - gradle/libs.versions.toml: [libraries] entries only — explicit
 *    module = "group:artifact" and the "group:artifact:version" shorthand.
 *    [versions] and [plugins] never name a groupId.
 *
 * v1 reads the root manifests only; multi-module chains are v2 territory.
 * null when no manifest file exists (no evidence — the gate step stays out
 * of the way); an empty Set is a legitimate "manifests exist, declare
 * nothing" answer. mtime-stamped across all four files, like readPythonDeps.
 *
 * @param {string} root
 * @returns {Set<string>|null}
 */
const JVM_MANIFEST_FILES = ['pom.xml', 'build.gradle', 'build.gradle.kts', path.join('gradle', 'libs.versions.toml')];

function readJvmDeps(root) {
  const stampOf = (p) => {
    try {
      return fs.statSync(p).mtimeMs;
    } catch {
      return 0;
    }
  };
  const files = JVM_MANIFEST_FILES.map((f) => path.join(root, f));
  const stamp = files.map(stampOf).join(':');
  if (stamp === '0:0:0:0') {
    _jvmDepsCache.delete(root);
    return null;
  }

  const cached = _jvmDepsCache.get(root);
  if (cached && cached.stamp === stamp) {
    return cached.prefixes;
  }

  const prefixes = new Set();
  const add = (raw) => {
    const g = String(raw || '').trim();
    // Property placeholders (${parent.groupId}) name nothing concrete.
    if (!g || g.includes('$')) return;
    prefixes.add(g);
  };

  try {
    if (stampOf(files[0])) {
      const content = fs.readFileSync(files[0], 'utf8').replace(/<!--[\s\S]*?-->/g, '');
      const blockRegex = /<(?:dependency|parent)\b[\s\S]*?<groupId>([^<]+)<\/groupId>[\s\S]*?<\/(?:dependency|parent)>/g;
      let m;
      while ((m = blockRegex.exec(content)) !== null) add(m[1]);
    }
  } catch {
    // unreadable pom.xml — gradle sources may still carry the facts
  }

  for (const idx of [1, 2]) {
    try {
      if (!stampOf(files[idx])) continue;
      const content = fs.readFileSync(files[idx], 'utf8');
      const coordRegex = /["']([A-Za-z][\w-]*(?:\.[\w-]+)+):[\w.-]+(?::[\w.+-]+)?["']/g;
      let m;
      while ((m = coordRegex.exec(content)) !== null) add(m[1]);
    } catch {
      // unreadable gradle file — other sources may still carry the facts
    }
  }

  try {
    if (stampOf(files[3])) {
      let inLibraries = false;
      for (const rawLine of fs.readFileSync(files[3], 'utf8').split('\n')) {
        const line = rawLine.replace(/#.*$/, '').trim();
        if (line.startsWith('[')) {
          inLibraries = line === '[libraries]';
          continue;
        }
        if (!inLibraries || !line) continue;
        const moduleMatch = line.match(/\bmodule\s*=\s*["']([^"':]+):/);
        if (moduleMatch) {
          add(moduleMatch[1]);
          continue;
        }
        const shorthand = line.match(/^[\w.-]+\s*=\s*["']([A-Za-z][\w-]*(?:\.[\w-]+)+):[\w.-]+/);
        if (shorthand) add(shorthand[1]);
      }
    }
  } catch {
    // unreadable version catalog — other sources may still carry the facts
  }

  _jvmDepsCache.set(root, { prefixes, stamp });
  return prefixes;
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

/**
 * The crate root that owns `fromFile`: the nearest ancestor directory (bounded
 * by `root`) containing a Cargo.toml. Workspaces routinely hold multiple
 * crates (qartez-mcp/qartez-dashboard), and `crate::` paths are relative to
 * their own crate's src, not the workspace root's.
 *
 * @param {string|null} fromFile
 * @param {string} root
 * @returns {string} falls back to `root` when no Cargo.toml is found
 */
function findCargoCrateRoot(fromFile, root) {
  if (!fromFile) return root;
  // Compare in normalizePathKey space (callers hand us raw or normalized
  // paths; on Windows those differ in case and separators) — but RETURN the
  // original-case directory: consumers climb/path-join against fromFile's own
  // casing, and a normalized return value would break their startsWith
  // arithmetic the other way.
  const rootNorm = normalizePathKey(root);
  let dir = path.dirname(fromFile);
  const cacheKey = normalizePathKey(dir);
  if (_cargoCrateRootCache.has(cacheKey)) {
    return _cargoCrateRootCache.get(cacheKey);
  }
  let found = null;
  for (;;) {
    const dirNorm = normalizePathKey(dir);
    if (dirNorm !== rootNorm && !dirNorm.startsWith(rootNorm + '/')) break;
    if (cachedExistsSync(path.join(dir, 'Cargo.toml'))) {
      found = dir;
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const result = found || root;
  _cargoCrateRootCache.set(cacheKey, result);
  return result;
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
  packageManifestChain,
  normalizeCrateName,
  readCargoCrateName,
  readCargoDeps,
  readPythonDeps,
  readJvmDeps,
  findCargoCrateRoot,
  _readTsconfigPaths,
  _tryResolveWithExtensions,
};
