const fs = require('fs');
const path = require('path');
const { readGoWorkspaceModules } = require('./base');

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

function tryGoModule(importPath, fromFile, ctx) {
  if (importPath.startsWith('.')) return null;

  const modules = readGoWorkspaceModules(ctx.root, fromFile);
  const modulePath = [...modules.keys()].filter(module => importPath === module || importPath.startsWith(module + '/')).sort((a, b) => b.length - a.length)[0];
  if (!modulePath) {
    return null;
  }

  let relPath = importPath.slice(modulePath.length);
  if (relPath.startsWith('/')) relPath = relPath.slice(1);

  const moduleRoot = modules.get(modulePath);
  const targetDir = relPath ? path.join(moduleRoot, relPath) : moduleRoot;
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
        // The import binds the whole package, not this anchor file.
        // The anchor only satisfies the single-path resolver contract; the
        // expand-go-packages post-process phase adds edges to every non-test
        // .go file in this dir.
        ctx.outMeta.goPackageDir = targetDir;
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
