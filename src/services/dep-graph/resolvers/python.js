const path = require('path');
const { readPythonDepsChain } = require('./base');
const { getPythonStdlibNames } = require('./python-stdlib');

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

/**
 * True when a Python import names somebody else's code: standard library, or
 * a package the manifest chain declares. The chain runs from the importer's
 * own directory up to the workspace root (the JS packageManifestChain
 * semantics — L2-11 gap A shape; 2026-09-24 串围标实测：pdf-inspector /
 * rapidocr-onnxruntime 只声明在 skill 的 requirements.txt，根口径漏判
 * 6 条)。Dotted submodule paths are attributed to their root: `os.path.join`
 * belongs to `os`. Relative imports never reach this function.
 */
function isExternalPythonImport(specifier, root, ctx = null) {
  const rootSegment = specifier.split('.')[0].trim();
  if (!rootSegment) return false;
  if (getPythonStdlibNames(root).has(rootSegment)) return true;
  if (!root) return false;
  const fromDir = ctx && ctx.fromFile ? path.dirname(ctx.fromFile) : null;
  const declared = readPythonDepsChain(fromDir, root);
  // Import names use underscores where package names use hyphens; the
  // manifest reader stores PEP 503-normalized names, so normalize the same
  // way before matching (`tree_sitter` ↔ `tree-sitter`).
  return Boolean(declared && declared.has(rootSegment.toLowerCase().replace(/[-_.]+/g, '-')));
}

/**
 * basename → files index over the graph's own .py set. Built once per resolve
 * batch by GraphBuilder from graph membership — NOT a fresh walk: a file the
 * graph does not know (reference/generated role, excluded dir) must never be
 * capturable by an import (measured: 串围标 `import report` 与
 * reference/liteparse 的 report.py 同名，必须仍解析到 skill 自己的那份)。
 */
function buildPythonModuleIndex(files) {
  const byBase = new Map();
  for (const f of files) {
    const norm = String(f).replace(/\\/g, '/');
    if (!norm.toLowerCase().endsWith('.py')) continue;
    const base = norm.endsWith('/__init__.py')
      ? norm.slice(0, -'/__init__.py'.length).split('/').pop()
      : norm.slice(0, -'.py'.length).split('/').pop();
    if (!base) continue;
    const list = byBase.get(base);
    if (list) list.push(f);
    else byBase.set(base, [f]);
  }
  return {
    /** Files that could be the module `a.b` (suffix /a/b.py or /a/b/__init__.py). */
    lookup(modulePath) {
      const suffix = `/${modulePath.split('.').join('/')}`;
      const base = modulePath.split('.').pop();
      const cands = byBase.get(base) || [];
      return cands.filter((f) => {
        const norm = String(f).replace(/\\/g, '/');
        return norm.endsWith(`${suffix}.py`) || norm.endsWith(`${suffix}/__init__.py`);
      });
    },
  };
}

/**
 * Last resort for bare/dotted Python imports: name a workspace FILE, not a
 * search root. Two deterministic steps, no name guessing:
 *   1. same-dir — the importer's own directory (entry-script dir is
 *      sys.path[0] by Python semantics; measured 15/15 correct on the
 *      串围标 dropped cohort, twin disambiguation included);
 *   2. unique module-index hit — exactly one graph .py can satisfy the
 *      specifier's module path.
 * Ambiguous (>1 candidates) returns null and stays in the droppedImports
 * ledger — measured residue: 8 twin pairs (af_client / model_call_audit /
 * deepseek_client 各有两份，跨 skill 靠 sys.path.insert 消歧，静态不可达)。
 * Declared externals never reach either step (ownership first — the JS
 * parsers/shared.js re-export incident's Python counterpart).
 */
function tryPythonModuleIndex(importPath, fromFile, ctx) {
  if (importPath.startsWith('.')) return null;
  if (!ctx.pythonModuleIndex) return null;
  if (isExternalPythonImport(importPath, ctx.root, { fromFile })) return null;

  const modulePath = importPath.split('.').join(path.sep);
  const sameDirBase = path.join(path.dirname(fromFile), modulePath);
  const sameDir = _tryPythonCandidates(sameDirBase, ctx) || _tryNamespaceSubmodule(sameDirBase, ctx);
  const matches = sameDir ? [sameDir] : ctx.pythonModuleIndex.lookup(importPath);
  if (matches.length !== 1) return null;

  if (ctx.outMeta) {
    // Inference class (a bare import naming an off-root workspace file) —
    // tier2/0.8 alongside symbol-table, not the tier1 path-existence tier.
    ctx.outMeta.method = 'python-module-index';
    ctx.outMeta.confidence = 0.8;
    ctx.outMeta.tier = 'tier2';
  }
  return matches[0];
}

module.exports = {
  tryPythonRelative,
  tryPythonAbsolute,
  tryPythonModuleIndex,
  buildPythonModuleIndex,
  isExternalPythonImport,
};
