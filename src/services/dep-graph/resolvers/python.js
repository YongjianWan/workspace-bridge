const path = require('path');

function _tryPythonCandidates(basePath, ctx) {
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
}

// PEP 420 namespace package: the specifier names a directory WITHOUT
// __init__.py (CodeGraphContext tools/handlers, tools/languages — L2-17).
// `from PKG import X` on a namespace package binds the submodule PKG/X —
// that is not a guess, it is the only thing the statement CAN mean (a
// namespace package has no code of its own, so X is a submodule or an
// ImportError). Callers must try the plain candidates first, so regular
// packages keep resolving to __init__.py and this stays a fallback.
function _tryNamespaceSubmodule(basePath, ctx) {
  if (!ctx.imported || ctx.imported.length === 0) return null;
  for (const name of ctx.imported) {
    if (!name || name === '*') continue;
    const submodule = _tryPythonCandidates(path.join(basePath, name), ctx);
    if (submodule) return submodule;
  }
  return null;
}

function _markResolved(ctx, method) {
  if (ctx.outMeta) {
    ctx.outMeta.method = method;
    ctx.outMeta.confidence = 1.0;
    ctx.outMeta.tier = 'tier1';
  }
}

function tryPythonRelative(importPath, fromFile, ctx) {
  if (!importPath.startsWith('.')) return null;

  const leadingDots = importPath.match(/^\.+/)[0].length;
  const remainder = importPath.slice(leadingDots);
  let currentDir = path.dirname(fromFile);

  for (let i = 1; i < leadingDots; i += 1) {
    currentDir = path.dirname(currentDir);
  }

  const basePath = remainder
    ? path.join(currentDir, ...remainder.split('.'))
    : currentDir;

  // Single base path here, so "plain first" needs no second pass — unlike
  // tryPythonAbsolute, which searches several roots.
  const resolved = _tryPythonCandidates(basePath, ctx) || _tryNamespaceSubmodule(basePath, ctx);
  if (!resolved) return null;
  _markResolved(ctx, 'python-relative');
  return resolved;
}

function tryPythonAbsolute(importPath, _fromFile, ctx) {
  if (importPath.startsWith('.')) return null;

  const modulePath = importPath.split('.').join(path.sep);
  const searchRoots = [
    ctx.root,
    path.join(ctx.root, 'backend'),
    path.join(ctx.root, 'src'),
    path.join(ctx.root, 'app'),
  ];

  // Two passes, not one per root. searchRoots is a heuristic priority list, so
  // a single `plain || namespace` loop would let an earlier root's namespace
  // fallback (weak: a directory that merely holds a matching filename) beat a
  // later root's real __init__.py (strong). The fallback is a fallback against
  // ALL roots, which is what "plain candidates always win" has to mean.
  for (const searchRoot of searchRoots) {
    const resolved = _tryPythonCandidates(path.join(searchRoot, modulePath), ctx);
    if (resolved) {
      _markResolved(ctx, 'python-absolute');
      return resolved;
    }
  }

  for (const searchRoot of searchRoots) {
    const resolved = _tryNamespaceSubmodule(path.join(searchRoot, modulePath), ctx);
    if (resolved) {
      _markResolved(ctx, 'python-absolute');
      return resolved;
    }
  }

  return null;
}

module.exports = {
  tryPythonRelative,
  tryPythonAbsolute,
};
