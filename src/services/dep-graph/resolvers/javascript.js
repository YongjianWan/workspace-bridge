const path = require('path');
const {
  TS_EXTENSIONS,
  JS_IMPORT_EXTENSIONS,
  RESOLVER_EXTENSIONS,
  INDEX_EXTENSIONS,
  _readTsconfigPaths,
  _tryResolveWithExtensions,
  cachedExistsSync,
} = require('./base');

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

function tryAlias(importPath, _fromFile, ctx) {
  if (importPath.startsWith('.') || importPath.startsWith('/')) return null;
  const resolved = _resolveAlias(importPath, ctx.root);
  if (resolved && ctx.outMeta) {
    ctx.outMeta.method = 'alias';
    ctx.outMeta.confidence = 1.0;
    ctx.outMeta.tier = 'tier1';
  }
  return resolved;
}

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
      if (ctx.outMeta) {
        ctx.outMeta.method = 'relative';
        ctx.outMeta.confidence = 1.0;
        ctx.outMeta.tier = 'tier1';
      }
      return candidate;
    }
  }

  const baseStat = ctx.cachedStatSync(resolvedBase);
  if (baseStat && baseStat.isDirectory()) {
    return null;
  }
  if (ctx.outMeta) {
    ctx.outMeta.method = 'relative';
    ctx.outMeta.confidence = 1.0;
    ctx.outMeta.tier = 'tier1';
  }
  return resolvedBase;
}

module.exports = {
  tryAlias,
  tryRelativeWithExtensions,
  _resolveAlias,
};
