const fs = require('fs');
const path = require('path');

function tryGoRelative(importPath, fromFile, ctx) {
  if (!importPath.startsWith('.')) return null;

  const fromDir = path.dirname(fromFile);
  const resolved = path.resolve(fromDir, importPath);
  if (ctx.cachedExistsSync(resolved)) {
    if (ctx.outMeta) {
      ctx.outMeta.method = 'go-relative';
      ctx.outMeta.confidence = 1.0;
      ctx.outMeta.tier = 'tier1';
    }
    return resolved;
  }
  const resolvedGo = `${resolved}.go`;
  if (ctx.cachedExistsSync(resolvedGo)) {
    if (ctx.outMeta) {
      ctx.outMeta.method = 'go-relative';
      ctx.outMeta.confidence = 1.0;
      ctx.outMeta.tier = 'tier1';
    }
    return resolvedGo;
  }
  return null;
}

function tryGoModule(importPath, _fromFile, ctx) {
  if (importPath.startsWith('.')) return null;

  const modulePath = ctx.readGoMod(ctx.root);
  if (!modulePath || !importPath.startsWith(modulePath)) {
    return null;
  }

  let relPath = importPath.slice(modulePath.length);
  if (relPath.startsWith('/')) relPath = relPath.slice(1);

  const targetDir = relPath ? path.join(ctx.root, relPath) : ctx.root;
  const targetDirStat = ctx.cachedStatSync(targetDir);
  if (!targetDirStat || !targetDirStat.isDirectory()) return null;

  try {
    const entries = fs.readdirSync(targetDir).sort();
    const goFile = entries.find((f) => f.endsWith('.go') && !f.endsWith('_test.go'));
    if (goFile) {
      const resolved = path.join(targetDir, goFile);
      if (ctx.outMeta) {
        ctx.outMeta.method = 'go-module';
        ctx.outMeta.confidence = 1.0;
        ctx.outMeta.tier = 'tier1';
      }
      return resolved;
    }
  } catch {
    // ignore
  }

  return null;
}

module.exports = {
  tryGoRelative,
  tryGoModule,
};
