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
      const resolved = _resolveWorkspaceEntry(dir, manifest, subpath, ctx);
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

// Export-target preference: static analysis wants the file a developer edits.
// Build outputs (dist/, pnpm build never ran on a fresh clone) and .d.ts
// declarations rank below source; among equal ranks the exports map order
// wins (conditions are commonly listed types-first). Measured on eval zod:
// self-references like `import from "zod/v4"` must land on src/v4/index.ts
// or test→source edges vanish and affected-tests recall collapses.
const EXPORT_RANK_SOURCE = 0;
const EXPORT_RANK_OUTPUT = 1;
const EXPORT_RANK_DECLARATION = 2;
const JS_BUILD_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs']);
const DECLARATION_NAME = /\.d\.(ts|mts|cts)$/i;

function _collectExportTargets(value, captured, out) {
  if (typeof value === 'string') {
    out.push(captured === null ? value : value.split('*').join(captured));
  } else if (Array.isArray(value)) {
    for (const item of value) _collectExportTargets(item, captured, out);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) _collectExportTargets(item, captured, out);
  }
  // null is a blocked subpath (node exports semantics): contributes no target.
}

/**
 * Targets that `exports` offers for a workspace package subpath ('' = bare
 * package name). Returns [] both when the map does not cover the subpath and
 * when it blocks it — the caller falls back to legacy probing either way, so a
 * never-resolved specifier can never resolve worse than before.
 */
function _workspaceExportTargets(exportsField, subpath) {
  const out = [];
  if (exportsField == null) return out;
  const importKey = subpath ? `./${subpath}` : '.';
  if (typeof exportsField === 'string' || Array.isArray(exportsField)) {
    if (!subpath) _collectExportTargets(exportsField, null, out);
    return out;
  }
  if (typeof exportsField !== 'object') return out;
  const keys = Object.keys(exportsField);
  // Node rejects mixing '.'-prefixed subpath keys with bare condition keys;
  // when '.'-prefixed keys exist, treat the object as a subpath map.
  if (!keys.some((key) => key.startsWith('.'))) {
    if (!subpath) _collectExportTargets(exportsField, null, out);
    return out;
  }
  if (Object.prototype.hasOwnProperty.call(exportsField, importKey)) {
    _collectExportTargets(exportsField[importKey], null, out);
    return out;
  }
  // Wildcard keys: longest prefix wins (node's specificity rule), and the
  // captured `*` segment is substituted into the target.
  let best = null;
  for (const key of keys) {
    const star = key.indexOf('*');
    if (star < 0) continue;
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    if (importKey.length < prefix.length + suffix.length) continue;
    if (!importKey.startsWith(prefix) || !importKey.endsWith(suffix)) continue;
    if (!best || prefix.length > best.prefix.length) best = { key, prefix, suffix };
  }
  if (best) {
    const captured = importKey.slice(best.prefix.length, importKey.length - best.suffix.length);
    _collectExportTargets(exportsField[best.key], captured, out);
  }
  return out;
}

function _exportCandidateRank(filePath) {
  if (DECLARATION_NAME.test(filePath)) return EXPORT_RANK_DECLARATION;
  const ext = path.extname(filePath).toLowerCase();
  return TS_EXTENSIONS.includes(ext) ? EXPORT_RANK_SOURCE : EXPORT_RANK_OUTPUT;
}

/**
 * Probe candidates for one exports target, source-leaning first:
 * `./dist/index.js` → dist/index.{ts,tsx,mts,cts} then the literal file;
 * extensionless targets (`./src/v4/locales/*`) get resolver + index probing;
 * anything else is tried verbatim. Targets resolving outside the package dir
 * (a `*` capture like `../evil`) are rejected.
 */
function _exportCandidates(dir, target) {
  if (typeof target !== 'string' || !target.startsWith('./')) return [];
  const pkgDir = path.resolve(dir);
  const abs = path.resolve(pkgDir, target.slice(2));
  if (abs !== pkgDir && !abs.startsWith(pkgDir + path.sep)) return [];
  const candidates = [];
  const ext = path.extname(abs).toLowerCase();
  if (JS_BUILD_EXTENSIONS.has(ext)) {
    const stem = abs.slice(0, -ext.length);
    for (const tsExt of TS_EXTENSIONS) candidates.push(`${stem}${tsExt}`);
    candidates.push(abs);
  } else if (ext) {
    candidates.push(abs);
  } else {
    for (const resolverExt of RESOLVER_EXTENSIONS) candidates.push(`${abs}${resolverExt}`);
    for (const indexExt of INDEX_EXTENSIONS) candidates.push(path.join(abs, `index${indexExt}`));
  }
  return candidates;
}

function _resolveWorkspaceEntry(dir, manifest, subpath, ctx) {
  let best = null;
  let bestRank = Infinity;
  for (const target of _workspaceExportTargets(manifest.exports, subpath)) {
    for (const candidate of _exportCandidates(dir, target)) {
      const stat = ctx.cachedStatSync(candidate);
      if (!stat || stat.isDirectory()) continue;
      const rank = _exportCandidateRank(candidate);
      if (rank < bestRank) {
        best = candidate;
        bestRank = rank;
      }
    }
  }
  if (best) return best;

  // Legacy probe (pre-exports behavior): entry path straight off the manifest.
  const entry = subpath || manifest.source || manifest.module || manifest.main || 'index';
  const entryPath = path.join(dir, entry);
  const entryStat = ctx.cachedStatSync(entryPath);
  return (entryStat?.isFile() ? entryPath : null)
    || _tryResolveWithExtensions(entryPath);
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
