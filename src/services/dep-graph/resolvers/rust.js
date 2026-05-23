const path = require('path');
const { cachedExistsSync } = require('./base');

function resolveRustModulePath(modulePath, root, baseDir) {
  const segments = modulePath.split('::').filter(Boolean);
  if (segments.length === 0) return null;

  const searchBase = baseDir || path.join(root, 'src');

  for (let i = segments.length; i > 0; i--) {
    const subPath = segments.slice(0, i).join('/');
    const candidates = [
      path.join(searchBase, `${subPath}.rs`),
      path.join(searchBase, `${subPath}/mod.rs`),
    ];
    for (const candidate of candidates) {
      if (cachedExistsSync(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

function tryRustCrate(importPath, _fromFile, ctx) {
  if (!importPath.startsWith('crate::')) return null;
  const modulePath = importPath.slice('crate::'.length);
  return resolveRustModulePath(modulePath, ctx.root);
}

function tryRustSuper(importPath, fromFile, ctx) {
  if (!importPath.startsWith('super::')) return null;

  const fromDir = path.dirname(fromFile);
  let baseDir = fromDir;
  let remaining = importPath;
  const srcRoot = path.join(ctx.root, 'src');

  while (remaining.startsWith('super::')) {
    remaining = remaining.slice('super::'.length);
    const parent = path.dirname(baseDir);
    if (parent === baseDir || !parent.startsWith(srcRoot)) {
      return null;
    }
    baseDir = parent;
  }

  if (!remaining) return null;
  return resolveRustModulePath(remaining, ctx.root, baseDir);
}

module.exports = {
  tryRustCrate,
  tryRustSuper,
  resolveRustModulePath,
};
