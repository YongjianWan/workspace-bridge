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
  packageManifestChain,
  normalizeCrateName,
  readCargoCrateName,
  findCargoCrateRoot,
  readCargoDeps,
  readPythonDeps,
} = require('./resolvers/base');
const { registry } = require('./parsers/registry');
const { getPythonStdlibNames } = require('./resolvers/python-stdlib');

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
  tryRustScoped,
} = require('./resolvers/rust');

const {
  tryCppInclude,
  CPP_EXTENSIONS,
  CPP_BUILTINS,
  C_SYSTEM_HEADERS,
} = require('./resolvers/cpp');

// ============================================================================
// Resolver Context and Strategy Registry — inspired by GitNexus pattern.
// ============================================================================

/**
 * Build a resolution context shared across strategies for a single resolveImport call.
 * @param {string} root
 * @param {object|null} symbolRegistry
 * @param {object|null} importHints — parser-written facts about the specifier
 *   (e.g. `{ isLocal: false }` for an angle-bracket C/C++ include). Null when
 *   the caller only knows the bare specifier.
 * @returns {object}
 */
function _buildContext(root, symbolRegistry = null, importHints = null) {
  return {
    root,
    cachedExistsSync,
    cachedStatSync,
    discoverJavaSourceRoots,
    readGoMod,
    symbolRegistry,
    importHints,
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
const JS_FAMILY_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts', '.vue', '.svelte']);
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
function _isExternalRustCrate(specifier, root, ctx) {
  const rootSegment = specifier.split('::')[0].trim();
  if (!rootSegment) return false;
  if (RUST_STDLIB_ROOTS.has(rootSegment)) return true;
  if (!root) return false;
  // Cargo workspaces: a member crate's deps live in ITS Cargo.toml
  // (qartez-dashboard declares axum; the root package does not). Cargo has no
  // manifest chain — `workspace = true` deps are re-declared in the member's
  // own file — so the nearest manifest is the whole truth.
  const crateRoot = ctx && ctx.fromFile ? findCargoCrateRoot(ctx.fromFile, root) : root;
  // The crate the file belongs to is internal by definition — never gate the
  // own-crate name (`qartez_mcp::…` must resolve, not be dropped).
  const ownCrate = readCargoCrateName(crateRoot);
  if (ownCrate && rootSegment === ownCrate) return false;
  const declared = readCargoDeps(crateRoot);
  return Boolean(declared && declared.has(normalizeCrateName(rootSegment)));
}

/**
 * True when a bare specifier names something that lives outside the workspace:
 * a node builtin, a declared dependency, or an installed package. Any hit on
 * such a specifier is a fabricated edge, and one sloppy re-export is enough to
 * mass-produce them: `parsers/js/shared.js` used to re-export its own
 * `require('path')`, which made every one of this repo's 212 `require('path')`
 * files resolve to it (measured 2026-07-28; that re-export has since been
 * deleted, so the gate now has nothing to catch here). Names like `debug`,
 * `config`, `glob` and `semver` are the same shape waiting to happen — the gate
 * exists so that ownership, a deterministic fact, outranks name guessing.
 */
function _isExternalJsPackage(specifier, root, ctx) {
  // Protocol-prefixed specifiers (node:fs, bun:sqlite, data:, http:) and
  // Windows drive-absolute paths are never workspace symbols.
  if (specifier.includes(':')) return true;
  const pkgName = _packageNameOf(specifier);
  if (NODE_BUILTINS.has(pkgName)) return true;
  if (!root) return false;
  // Manifest chain from the importing file up to the workspace root: monorepo
  // sub-packages declare their own deps, so the root manifest alone is not
  // the whole truth (L2-11 gap A). No fromFile → root manifest only, same as
  // before.
  const fromDir = ctx && ctx.fromFile ? path.dirname(ctx.fromFile) : null;
  for (const dir of packageManifestChain(fromDir, root)) {
    const declared = readPackageDeps(dir);
    if (declared && declared.has(pkgName)) return true;
    if (cachedExistsSync(path.join(dir, 'node_modules', pkgName))) return true;
  }
  return false;
}

// Python stdlib membership has a single home: resolvers/python-stdlib.js
// (authoritative sys.stdlib_module_names + degraded-path fallback, L3-15).

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
  if (getPythonStdlibNames(root).has(rootSegment)) return true;
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
 * True when a C/C++ include names a header owned by the toolchain, not the repo.
 *
 * Three deterministic rules, in decreasing strength:
 *  1. Angle-bracket form (`importHints.isLocal === false`, written by the
 *     parser) is toolchain territory by definition — even third-party angle
 *     includes like <boost/...> are never local-symbol guesses. Without this,
 *     the '.'-only delimiter reduces 'boost/algorithm/string.hpp' to 'hpp'
 *     and guesses a symbol named after an extension.
 *  2. Extensionless specifiers follow C++ stdlib naming (vector, algorithm) —
 *     extensionless local headers are already resolved by tryCppInclude before
 *     this gate ever runs, so blocking here costs nothing.
 *  3. The named C/POSIX system header lists (C_SYSTEM_HEADERS, CPP_BUILTINS).
 *
 * What this deliberately does NOT cover: quote-form third-party headers that
 * failed local resolution ('generated.h' from a build step). Their guess key
 * is the extension, which misses harmlessly.
 */
function _isExternalCppHeader(specifier, root, ctx) {
  if (ctx && ctx.importHints && ctx.importHints.isLocal === false) return true;
  const base = specifier.replace(/\\/g, '/').split('/').pop();
  const dot = base.lastIndexOf('.');
  if (dot === -1) return true;
  const lower = base.toLowerCase();
  if (C_SYSTEM_HEADERS.has(lower)) return true;
  if (CPP_BUILTINS.has(base.slice(0, dot))) return true;
  return false;
}

/**
 * Per-language dispatch for "does this specifier belong to somebody else".
 *
 * One table instead of a chain of extension tests inside trySymbolTable; adding
 * a language means adding a row plus its manifest reader (TECH_DEBT L2-11).
 * isExternal receives (specifier, root, ctx); ctx is null-safe for rows that
 * only need the specifier.
 */
/**
 * JVM zero-list gate (L2-11 gap C). Java/Kotlin imports are always
 * fully-qualified, and the parser already extracts every workspace file's
 * `package` declaration into the graph — so "not inside any workspace
 * package = external" is a deterministic fact. No pom/gradle reader, no
 * groupId guessing, same shape as Go's zero-list gate. The package set comes
 * from the builder via ctx.workspacePackages; absent or empty means "unknown"
 * and the gate stays out of the way (old behavior: only stdlib gated).
 * Stdlib prefixes keep their single home in the registry's isBuiltIn.
 */
function _isExternalJvmPackage(specifier, root, ctx, fromExt) {
  const lang = registry.findByExt(fromExt);
  if (lang && typeof lang.isBuiltIn === 'function' && lang.isBuiltIn(specifier)) return true;
  const pkgs = ctx && ctx.workspacePackages;
  if (!pkgs || pkgs.size === 0) return false;
  const base = specifier.endsWith('.*') ? specifier.slice(0, -2) : specifier;
  for (const pkg of pkgs) {
    if (base === pkg || base.startsWith(pkg + '.') || pkg.startsWith(base + '.')) return false;
  }
  return true;
}

const EXTERNAL_DEPENDENCY_CHECKS = [
  { matches: (ext) => JS_FAMILY_EXTENSIONS.has(ext), isExternal: _isExternalJsPackage },
  { matches: (ext) => ext === '.rs', isExternal: _isExternalRustCrate },
  { matches: (ext) => ext === '.py', isExternal: _isExternalPythonModule },
  { matches: (ext) => ext === '.go', isExternal: _isExternalGoModule },
  { matches: (ext) => CPP_EXTENSIONS.has(ext), isExternal: _isExternalCppHeader },
  { matches: (ext) => ext === '.java' || ext === '.kt', isExternal: _isExternalJvmPackage },
];

function _isExternalDependency(specifier, fromExt, root, ctx = null) {
  const check = EXTERNAL_DEPENDENCY_CHECKS.find((c) => c.matches(fromExt));
  if (check) return check.isExternal(specifier, root, ctx, fromExt);
  // Languages without a gate row still own a builtin list: the registry's
  // isBuiltIn declarations. Consulting them here retired L3-6 (the
  // declarations had zero consumers until this line).
  const lang = registry.findByExt(fromExt);
  return Boolean(lang && typeof lang.isBuiltIn === 'function' && lang.isBuiltIn(specifier));
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
  if (_isExternalDependency(importPath, ext, ctx.root, { ...ctx, fromFile })) return null;

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
  // T6 (2026-07-31): the symbol-table fallback is per-language, declared on
  // the registry entry (symbolTableFallback). Off for JS family + Python
  // (measured zero true-positive, TECH_DEBT L2-10); on for JVM (its only
  // legal shape) and Rust/Go/C++ (pending their own measurements).
  const strategies = lang.symbolTableFallback === false
    ? [...lang.resolveStrategies]
    : [...lang.resolveStrategies, trySymbolTable];
  for (const ext of lang.extensions) {
    registerResolverConfig(ext, strategies);
  }
}
registerResolverConfig('default', [tryAlias, tryRelativeWithExtensions, trySymbolTable]);

function resolveImport(fromFile, importPath, ext, root, symbolRegistry = null, outMeta = null, importHints = null, extraCtx = null) {
  if (!importPath) return null;
  let resolver = _resolverCache.get(ext);
  if (!resolver) {
    const strategies = RESOLVER_CONFIGS.get(ext) || RESOLVER_CONFIGS.get('default');
    resolver = createResolver(strategies);
    _resolverCache.set(ext, resolver);
  }
  const ctx = _buildContext(root, symbolRegistry, importHints);
  if (extraCtx) Object.assign(ctx, extraCtx);
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
  tryRustScoped,
  tryCppInclude,
  trySymbolTable,
  // Public gate query for "would this specifier be dropped *expectedly*"
  // (builder's droppedImports accounting, L2-13).
  isExternalDependency: _isExternalDependency,
};
