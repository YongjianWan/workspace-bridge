const path = require('path');

function tryJava(importPath, _fromFile, ctx) {
  if (!importPath || importPath.endsWith('.*')) {
    return null;
  }
  const relative = importPath.split('.').join(path.sep);
  const candidates = ctx.discoverJavaSourceRoots(ctx.root).map((r) => path.join(r, relative));

  for (const base of candidates) {
    for (const ext of ['.java', '.kt']) {
      const fullPath = `${base}${ext}`;
      if (ctx.cachedExistsSync(fullPath)) {
        return fullPath;
      }
    }
  }
  return null;
}

module.exports = {
  tryJava,
};
