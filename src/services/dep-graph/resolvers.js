const path = require('path');
const { builtinModules } = require('module');
const {
  _resolverCache,
  clearResolverCaches,
  cachedExistsSync,
  cachedStatSync,
  discoverJavaSourceRoots,
  readGoMod,
  readPackageDeps,
  readCargoDeps,
  readPythonDeps,
} = require('./resolvers/base');
const { registry } = require('./parsers/registry');

const {
  tryAlias,
  tryRelativeWithExtensions,
} = require('./resolvers/javascript');

const {
  tryPythonRelative,
  tryPythonAbsolute,
} = require('./resolvers/python');

const {
  tryJava,
} = require('./resolvers/java');

const {
  tryGoRelative,
  tryGoModule,
} = require('./resolvers/go');

const {
  tryRustCrate,
  tryRustSuper,
} = require('./resolvers/rust');

// ============================================================================
// Resolver Context and Strategy Registry — inspired by GitNexus pattern.
// ============================================================================

/**
 * Build a resolution context shared across strategies for a single resolveImport call.
 * @param {string} root
 * @param {object|null} symbolRegistry
 * @returns {object}
 */
function _buildContext(root, symbolRegistry = null) {
  return {
    root,
    cachedExistsSync,
    cachedStatSync,
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
  if (ext === 'default') {
    _resolverCache.clear();
  } else {
    _resolverCache.delete(ext);
  }
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
// Strategy: SymbolRegistry fallback
// Fallback when all heuristic string-matching strategies fail.
// Looks up the last segment of the import path as a symbol name in the
// workspace-wide SymbolRegistry. Only activates when a registry is provided.
// ---------------------------------------------------------------------------
const JS_FAMILY_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts', '.vue']);
const NODE_BUILTINS = new Set(builtinModules);

/**
 * Package name a bare specifier belongs to: 'lodash/merge' -> 'lodash',
 * '@scope/kit/merge' -> '@scope/kit'.
 */
function _packageNameOf(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

// Rust paths that can never name a workspace file.
const RUST_STDLIB_ROOTS = new Set(['std', 'core', 'alloc', 'proc_macro', 'test']);

/**
 * True when a Rust path is rooted at the standard library or at a crate the
 * manifest declares. Measured on reference/qartez-mcp: 48 of its 361
 * symbol-table edges came from `std::process::Command`, `rmcp::…` and
 * `tokio::…` landing on local files that happened to declare the trailing
 * name. `crate::` / `super::` / `self::` are workspace-internal by definition
 * and stay resolvable.
 */
function _isExternalRustCrate(specifier, root) {
  const rootSegment = specifier.split('::')[0].trim();
  if (!rootSegment) return false;
  if (RUST_STDLIB_ROOTS.has(rootSegment)) return true;
  if (!root) return false;
  const declared = readCargoDeps(root);
  return Boolean(declared && declared.has(rootSegment.replace(/-/g, '_')));
}

/**
 * True when a bare specifier names something that lives outside the workspace:
 * a node builtin, a declared dependency, or an installed package. Its last
 * segment collides with local export names often enough (debug, config, glob,
 * semver, path) that a hit would be a fabricated edge — 209 of this repo's own
 * 1219 edges were exactly that before the gate existed.
 */
function _isExternalJsPackage(specifier, root) {
  // Protocol-prefixed specifiers (node:fs, bun:sqlite, data:, http:) and
  // Windows drive-absolute paths are never workspace symbols.
  if (specifier.includes(':')) return true;
  const pkgName = _packageNameOf(specifier);
  if (NODE_BUILTINS.has(pkgName)) return true;
  if (!root) return false;
  const declared = readPackageDeps(root);
  if (declared && declared.has(pkgName)) return true;
  return cachedExistsSync(path.join(root, 'node_modules', pkgName));
}

// Python 3 standard library top-level modules can never name a workspace
// file, exactly like node builtins. (`os`, `sys`, `json`… colliding with a
// local module is the same fabricated-edge shape as require('path').)
const PYTHON_STDLIB_ROOTS = new Set([
  'abc', 'aifc', 'argparse', 'array', 'ast', 'asyncio', 'atexit', 'audioop',
  'base64', 'bdb', 'binascii', 'binhex', 'bisect', 'builtins', 'bz2',
  'calendar', 'cgi', 'cgitb', 'chunk', 'cmath', 'cmd', 'code', 'codecs',
  'codeop', 'collections', 'colorsys', 'compileall', 'concurrent', 'configparser',
  'contextlib', 'contextvars', 'copy', 'copyreg', 'crypt', 'csv', 'ctypes',
  'curses', 'dataclasses', 'datetime', 'dbm', 'decimal', 'difflib', 'dis',
  'distutils', 'doctest', 'email', 'encodings', 'enum', 'errno', 'faulthandler',
  'fcntl', 'filecmp', 'fileinput', 'fnmatch', 'fractions', 'ftplib', 'functools',
  'gc', 'getopt', 'getpass', 'gettext', 'glob', 'graphlib', 'grp', 'gzip',
  'hashlib', 'heapq', 'hmac', 'html', 'http', 'imaplib', 'imghdr', 'importlib',
  'inspect', 'io', 'ipaddress', 'itertools', 'json', 'keyword', 'linecache',
  'locale', 'logging', 'lzma', 'mailbox', 'mailcap', 'marshal', 'math',
  'mimetypes', 'mmap', 'modulefinder', 'multiprocessing', 'netrc', 'nis',
  'nntplib', 'numbers', 'operator', 'optparse', 'os', 'ossaudiodev', 'pathlib',
  'pdb', 'pickle', 'pickletools', 'pipes', 'pkgutil', 'platform', 'plistlib',
  'poplib', 'posix', 'pprint', 'profile', 'pstats', 'pty', 'pwd', 'py_compile',
  'pyclbr', 'pydoc', 'queue', 'quopri', 'random', 're', 'readline', 'reprlib',
  'resource', 'rlcompleter', 'runpy', 'sched', 'secrets', 'select', 'selectors',
  'shelve', 'shlex', 'shutil', 'signal', 'site', 'smtpd', 'smtplib', 'sndhdr',
  'socket', 'socketserver', 'sqlite3', 'ssl', 'stat', 'statistics', 'string',
  'stringprep', 'struct', 'subprocess', 'sunau', 'symtable', 'sys', 'sysconfig',
  'syslog', 'tabnanny', 'tarfile', 'telnetlib', 'tempfile', 'termios', 'test',
  'textwrap', 'threading', 'time', 'timeit', 'tkinter', 'token', 'tokenize',
  'trace', 'traceback', 'tracemalloc', 'tty', 'turtle', 'types', 'typing',
  'unicodedata', 'unittest', 'urllib', 'uu', 'uuid', 'venv', 'warnings',
  'wave', 'weakref', 'webbrowser', 'winreg', 'winsound', 'wsgiref', 'xdrlib',
  'xml', 'xmlrpc', 'zipapp', 'zipfile', 'zipimport', 'zlib', '_thread',
]);

/**
 * True when a Python import is rooted at the standard library or at a package
 * the project manifest declares (requirements.txt / pyproject.toml, both
 * formats merged by readPythonDeps). Dotted submodule paths are attributed to
 * their root: `os.path.join` belongs to `os`. Relative imports (leading dot)
 * never reach this function — trySymbolTable already filtered them.
 */
function _isExternalPythonModule(specifier, root) {
  const rootSegment = specifier.split('.')[0].trim();
  if (!rootSegment) return false;
  if (PYTHON_STDLIB_ROOTS.has(rootSegment)) return true;
  if (!root) return false;
  const declared = readPythonDeps(root);
  // Import names use underscores where package names use hyphens; the
  // manifest reader stores PEP 503-normalized names, so normalize the same
  // way before matching (`tree_sitter` ↔ `tree-sitter`).
  return Boolean(declared && declared.has(rootSegment.toLowerCase().replace(/[-_.]+/g, '-')));
}

/**
 * True when a Go import names anything outside the module's own packages.
 * Go imports always carry their full path, so ownership is deterministic and
 * needs no stdlib list: a specifier rooted at the module path from go.mod is
 * workspace-internal (symmetric to Rust's qartez_mcp:: case); a dotted first
 * segment is an external module (github.com/…); a dot-less one is the
 * standard library (fmt, encoding/json). Guessing either external class
 * against local symbols is pure fabrication risk — the measured symbol-table
 * contribution on Go repos is 0 anyway.
 */
function _isExternalGoModule(specifier, root) {
  if (root) {
    const modulePath = readGoMod(root);
    if (modulePath && (specifier === modulePath || specifier.startsWith(`${modulePath}/`))) {
      return false;
    }
  }
  return true;
}

/**
 * Per-language dispatch for "does this specifier belong to somebody else".
 *
 * One table instead of a chain of extension tests inside trySymbolTable; adding
 * a language means adding a row plus its manifest reader (TECH_DEBT L2-11).
 */
const EXTERNAL_DEPENDENCY_CHECKS = [
  { matches: (ext) => JS_FAMILY_EXTENSIONS.has(ext), isExternal: _isExternalJsPackage },
  { matches: (ext) => ext === '.rs', isExternal: _isExternalRustCrate },
  { matches: (ext) => ext === '.py', isExternal: _isExternalPythonModule },
  { matches: (ext) => ext === '.go', isExternal: _isExternalGoModule },
];

function _isExternalDependency(specifier, fromExt, root) {
  const check = EXTERNAL_DEPENDENCY_CHECKS.find((c) => c.matches(fromExt));
  return check ? check.isExternal(specifier, root) : false;
}

function trySymbolTable(importPath, fromFile, ctx) {
  if (!ctx.symbolRegistry) return null;
  // Relative and absolute filesystem paths are out of scope for symbol lookup.
  if (importPath.startsWith('.') || importPath.startsWith('/')) return null;

  // Third-party ownership is a deterministic fact, so it outranks the whole
  // heuristic: a specifier the ecosystem's manifest already assigns to someone
  // else is never guessed against local symbols. Languages whose manifest we
  // cannot read yet (Java, Kotlin) fall through — see TECH_DEBT L2-11.
  const ext = fromFile ? path.extname(fromFile).toLowerCase() : '';
  if (_isExternalDependency(importPath, ext, ctx.root)) return null;

  // Delimiter set is language-scoped: '::' for Rust paths, '/' + '.' for Go
  // package paths ('pkg/sub.Func'). Everything else (JS/TS, Python, Java)
  // keeps '.' only — splitting npm subpath imports ('lodash/merge') would
  // alias them onto same-named local symbols.
  const delimiters = ext === '.rs' ? /:+/ : ext === '.go' ? /[./]+/ : /\./;
  const parts = importPath.split(delimiters).filter(Boolean);
  const symbolName = parts.length > 0 ? parts[parts.length - 1] : importPath;
  if (!symbolName) return null;

  const resolved = ctx.symbolRegistry.lookupBestMatch(symbolName, fromFile);

  if (resolved && ctx.outMeta) {
    ctx.outMeta.method = 'symbol-table';
    ctx.outMeta.confidence = 0.8;
    ctx.outMeta.tier = 'tier2';
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Legacy helpers (kept for internal use and backward compat)
// ---------------------------------------------------------------------------

function resolveJavaImport(importPath, root) {
  const ctx = _buildContext(root);
  return tryJava(importPath, null, ctx);
}

// Register resolver configs for all supported extensions dynamically from registry.
for (const lang of registry.languages) {
  const strategies = [...lang.resolveStrategies, trySymbolTable];
  for (const ext of lang.extensions) {
    registerResolverConfig(ext, strategies);
  }
}
registerResolverConfig('default', [tryAlias, tryRelativeWithExtensions, trySymbolTable]);

function resolveImport(fromFile, importPath, ext, root, symbolRegistry = null, outMeta = null) {
  if (!importPath) return null;
  let resolver = _resolverCache.get(ext);
  if (!resolver) {
    const strategies = RESOLVER_CONFIGS.get(ext) || RESOLVER_CONFIGS.get('default');
    resolver = createResolver(strategies);
    _resolverCache.set(ext, resolver);
  }
  const ctx = _buildContext(root, symbolRegistry);
  if (outMeta) {
    ctx.outMeta = outMeta;
  }
  return resolver(importPath, fromFile, ctx);
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
