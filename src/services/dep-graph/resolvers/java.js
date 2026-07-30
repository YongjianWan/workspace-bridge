const path = require('path');

function tryJava(importPath, _fromFile, ctx) {
  if (!importPath || importPath.endsWith('.*')) {
    return null;
  }
  const segments = importPath.split('.');
  const roots = ctx.discoverJavaSourceRoots(ctx.root);

  // Longest match wins: Kotlin companion/extension and Java nested-class
  // imports extend PAST the class name (`okhttp3.HttpUrl.Companion.toHttpUrl`,
  // `com.foo.Outer.Inner`), so strip trailing segments until a file matches.
  // The file binding stays exact — a member of HttpUrl is declared in (or on)
  // HttpUrl.kt, and stripping stops at the first hit, never overshooting into
  // a package-level guess.
  for (let end = segments.length; end > 1; end--) {
    const relative = segments.slice(0, end).join(path.sep);
    for (const base of roots) {
      for (const ext of ['.java', '.kt']) {
        const fullPath = path.join(base, relative) + ext;
        if (ctx.cachedExistsSync(fullPath)) {
          if (ctx.outMeta) {
            ctx.outMeta.method = 'java-package';
            ctx.outMeta.confidence = 1.0;
            ctx.outMeta.tier = 'tier1';
          }
          return fullPath;
        }
      }
    }
  }
  return null;
}

module.exports = {
  tryJava,
};
