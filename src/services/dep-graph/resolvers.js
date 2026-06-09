const path = require('path');
const {
  _resolverCache,
  clearResolverCaches,
  cachedExistsSync,
  cachedStatSync,
  discoverJavaSourceRoots,
  readGoMod,
} = require('./resolvers/base');

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
  const resolved = ctx.symbolRegistry.lookupUnique(symbolName, fromDir);
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

// Register resolver configs for all supported extensions.
// Adding a new language requires exactly one line here.
registerResolverConfig('.py', [tryPythonRelative, tryPythonAbsolute, trySymbolTable]);
registerResolverConfig('.java', [tryJava, trySymbolTable]);
registerResolverConfig('.kt', [tryJava, trySymbolTable]);
registerResolverConfig('.go', [tryGoRelative, tryGoModule, trySymbolTable]);
registerResolverConfig('.rs', [tryRustCrate, tryRustSuper, trySymbolTable]);
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
