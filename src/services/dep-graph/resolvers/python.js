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

  return tryPythonCandidates(basePath) || basePath;
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
      return resolved;
    }
  }

  return null;
}

module.exports = {
  tryPythonRelative,
  tryPythonAbsolute,
};
