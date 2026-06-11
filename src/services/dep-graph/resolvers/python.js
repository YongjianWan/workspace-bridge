const path = require('path');

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

  const resolved = tryPythonCandidates(basePath);
  if (!resolved) return null;
  if (ctx.outMeta) {
    ctx.outMeta.method = 'python-relative';
    ctx.outMeta.confidence = 1.0;
    ctx.outMeta.tier = 'tier1';
  }
  return resolved;
}

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
      if (ctx.outMeta) {
        ctx.outMeta.method = 'python-absolute';
        ctx.outMeta.confidence = 1.0;
        ctx.outMeta.tier = 'tier1';
      }
      return resolved;
    }
  }

  return null;
}

module.exports = {
  tryPythonRelative,
  tryPythonAbsolute,
};
