const path = require('path');
const fs = require('fs');
const {
  TS_EXTENSIONS,
  JS_IMPORT_EXTENSIONS,
  RESOLVER_EXTENSIONS,
  INDEX_EXTENSIONS,
  _readTsconfigPaths,
  _tryResolveWithExtensions,
  cachedExistsSync,
} = require('./base');

function _resolveAlias(importPath, root, fromFile = null) {
  if (!root) return null;
  const tsconfig = _readTsconfigPaths(root, fromFile);
  if (tsconfig?.entries) {
    for (const entry of tsconfig.entries) {
      if (importPath.startsWith(entry.prefix)) {
        const suffix = importPath.slice(entry.prefix.length);
        for (const target of entry.targets) {
          const targetPath = target.hasWildcard
            ? path.join(target.baseDir, target.prefix + suffix)
            : path.join(target.baseDir, target.target);
          const found = _tryResolveWithExtensions(targetPath) || targetPath;
          if (cachedExistsSync(found)) return found;
        }
      }
    }
  } else if (tsconfig?.paths) {
    for (const [key, values] of Object.entries(tsconfig.paths)) {
      const prefix = key.replace(/\*$/, '');
      if (importPath.startsWith(prefix)) {
        const suffix = importPath.slice(prefix.length);
        for (const mapped of values) {
          const mappedPrefix = mapped.replace(/\*$/, '');
          const resolved = path.join(tsconfig.baseDir || root, tsconfig.baseUrl || '.', mappedPrefix + suffix);
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

function tryAlias(importPath, fromFile, ctx) {
  if (importPath.startsWith('.') || importPath.startsWith('/')) return null;
  const resolved = _resolveAlias(importPath, ctx.root, fromFile);
  if (resolved && ctx.outMeta) {
    ctx.outMeta.method = 'alias';
    ctx.outMeta.confidence = 1.0;
    ctx.outMeta.tier = 'tier1';
  }
  return resolved;
}

function workspacePatterns(root) {
  let npmPatterns = [];
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    npmPatterns = Array.isArray(manifest.workspaces)
      ? manifest.workspaces
      : manifest.workspaces?.packages || [];
  } catch { /* A pnpm workspace need not have a root package.json. */ }

  let pnpmPatterns = [];
  try {
    const yaml = fs.readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8');
    const packages = yaml.match(/^packages:\s*\r?\n((?:[ \t]+[^\r\n]*\r?\n?)*)/m)?.[1] || '';
    pnpmPatterns = [...packages.matchAll(/^\s*-\s*['"]?([^'"\s#]+)['"]?/gm)].map((match) => match[1]);
  } catch { /* npm workspaces need no pnpm file. */ }
  return [...npmPatterns, ...pnpmPatterns].filter((value) => typeof value === 'string' && !value.startsWith('!'));
}

function workspaceDirs(root, pattern) {
  let dirs = [root];
  for (const part of pattern.replace(/\\/g, '/').split('/').filter(Boolean)) {
    if (part === '.' || part === '**') continue;
    const next = [];
    for (const dir of dirs) {
      if (part === '*') {
        try {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.isDirectory() && entry.name !== 'node_modules') next.push(path.join(dir, entry.name));
          }
        } catch { /* Missing optional workspace directory. */ }
      } else if (part !== '..') {
        next.push(path.join(dir, part));
      }
    }
    dirs = next;
  }
  return dirs;
}

function tryWorkspacePackage(importPath, fromFile, ctx) {
  if (!ctx.root || importPath.startsWith('.') || importPath.startsWith('/') || importPath.includes(':')) return null;
  for (const pattern of workspacePatterns(ctx.root)) {
    for (const dir of workspaceDirs(ctx.root, pattern)) {
      let manifest;
      try { manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); } catch { continue; }
      if (!manifest.name || (importPath !== manifest.name && !importPath.startsWith(`${manifest.name}/`))) continue;
      const subpath = importPath.slice(manifest.name.length).replace(/^\//, '');
      const entry = subpath || manifest.source || manifest.module || manifest.main || 'index';
      const entryPath = path.join(dir, entry);
      const entryStat = ctx.cachedStatSync(entryPath);
      const resolved = (entryStat?.isFile() ? entryPath : null)
        || _tryResolveWithExtensions(entryPath);
      if (!resolved) continue;
      if (ctx.outMeta) {
        ctx.outMeta.method = 'workspace-package';
        ctx.outMeta.confidence = 1.0;
        ctx.outMeta.tier = 'tier1';
      }
      return resolved;
    }
  }
  return null;
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
  tryWorkspacePackage,
  tryRelativeWithExtensions,
  _resolveAlias,
};
