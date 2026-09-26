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
// ImportError). Two roles since P0-1: fallback when no plain candidate
// exists (this shape), and — inside _tryPackageOrSubmodule / tryPythonAbsolute
// pass 1 — the submodule that outranks the package's own __init__.py when
// the X/<name>.py file exists. A directory that is neither (no <name>.py,
// no <name>/__init__.py) still never fabricates an edge.
function _tryNamespaceSubmodule(basePath, ctx) {
  if (!ctx.imported || ctx.imported.length === 0) return null;
  for (const name of ctx.imported) {
    if (!name || name === '*') continue;
    const submodule = _tryPythonCandidates(path.join(basePath, name), ctx);
    if (submodule) return submodule;
  }
  return null;
}

// P0-1 (审查报告 §4): `from X import a` 在 X/a.py 或 X/a/__init__.py 存在时
// 绑定子模块文件，而不是 X/__init__.py —— 这是文件系统事实（同 tier1
// path-existence 档），不是名字猜测。只有 plain 命中的是「本包自己的
// __init__.py」时才让位：X.py 模块文件没有子模块、原样返回；纯目录
// （无 X.py 也无 X/__init__.py）不凭空造边，由下方 namespace 兜底接管。
function _tryPackageOrSubmodule(basePath, ctx) {
  const plain = _tryPythonCandidates(basePath, ctx);
  if (plain && plain !== path.join(basePath, '__init__.py')) return plain;
  return _tryNamespaceSubmodule(basePath, ctx) || plain;
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

  // Single base path here, so the submodule-vs-init decision is one package
  // deep — unlike tryPythonAbsolute, which searches several roots.
  const resolved = _tryPackageOrSubmodule(basePath, ctx);
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
  // P0-1 sits INSIDE pass 1 and only ever re-ranks within the winning
  // package: a plain hit that is X/__init__.py yields to X/<from-name>.py in
  // the SAME directory — a later root's strong evidence still beats an earlier
  // root's namespace dir, because the submodule check never runs for a root
  // whose plain candidates failed.
  for (const searchRoot of searchRoots) {
    const pkgBase = path.join(searchRoot, modulePath);
    const plain = _tryPythonCandidates(pkgBase, ctx);
    if (plain) {
      const submodule = plain === path.join(pkgBase, '__init__.py')
        ? _tryNamespaceSubmodule(pkgBase, ctx)
        : null;
      _markResolved(ctx, 'python-absolute');
      return submodule || plain;
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

// Two halves of the tier2 inference class get different confidence: an
// unambiguous hit is evidence, nearest-twin is a path-proximity judgment
// (sys.path order could favor the other copy at runtime).
const MODULE_INDEX_CONFIDENCE = Object.freeze({ EXACT: 0.8, NEAREST: 0.6 });

/**
 * Path segments for prefix arithmetic: '/'-normalized and case-folded, the
 * same Windows tolerance base.js applies in normalizePathKey space — callers
 * hand paths in either casing/separators, and prefix depth must not care.
 */
function _pathSegments(p) {
  return String(p).replace(/\\/g, '/').toLowerCase().split('/').filter(Boolean);
}

/**
 * The candidate sharing the most path segments with fromFile — or null when
 * the deepest prefix is a tie. Pure argmax over prefix depth, order-independent.
 */
function _nearestByCommonPrefix(candidates, fromFile) {
  const fromSegs = _pathSegments(fromFile);
  let best = null;
  let bestDepth = -1;
  let tied = false;
  for (const cand of candidates) {
    const segs = _pathSegments(cand);
    let depth = 0;
    while (depth < fromSegs.length && depth < segs.length && fromSegs[depth] === segs[depth]) depth += 1;
    if (depth > bestDepth) {
      best = cand;
      bestDepth = depth;
      tied = false;
    } else if (depth === bestDepth) {
      tied = true;
    }
  }
  return tied ? null : best;
}

/**
 * Last resort for bare/dotted Python imports: name a workspace FILE, not a
 * search root. Three deterministic steps, no name guessing:
 *   1. same-dir — the importer's own directory (entry-script dir is
 *      sys.path[0] by Python semantics; measured 15/15 correct on the
 *      串围标 dropped cohort, twin disambiguation included);
 *   2. unique module-index hit — exactly one graph .py can satisfy the
 *      specifier's module path;
 *   3. nearest-twin — several candidates satisfy it: the one sharing the
 *      deepest path prefix with fromFile wins when unique (skill 的 tests/
 *      经 conftest 注入自己 scripts/ 后裸名 import 自己那份拷贝，串围标
 *      dropped 残留的主形态).
 * A tie on step 3 returns null and stays in the droppedImports ledger
 * (neutral importer, statically ambiguous). Declared externals never reach
 * these steps (ownership first — the JS parsers/shared.js re-export
 * incident's Python counterpart).
 */
function tryPythonModuleIndex(importPath, fromFile, ctx) {
  if (importPath.startsWith('.')) return null;
  if (!ctx.pythonModuleIndex) return null;
  if (isExternalPythonImport(importPath, ctx.root, { fromFile })) return null;

  const modulePath = importPath.split('.').join(path.sep);
  const sameDirBase = path.join(path.dirname(fromFile), modulePath);
  const sameDir = _tryPackageOrSubmodule(sameDirBase, ctx);
  const matches = sameDir ? [sameDir] : ctx.pythonModuleIndex.lookup(importPath);

  let resolved = null;
  let nearest = false;
  if (matches.length === 1) {
    [resolved] = matches;
  } else if (matches.length > 1) {
    resolved = _nearestByCommonPrefix(matches, fromFile);
    nearest = resolved !== null;
  }
  if (!resolved) return null;

  // P0-1 same rule on the lookup path: when the winner is a package
  // __init__.py, a from-name that IS a submodule of that very package
  // outranks the init. The package itself came from the index; the sibling
  // check is path-existence like every other P0-1 decision (same-dir origin
  // already applied it inside _tryPackageOrSubmodule, so this is a no-op
  // there).
  if (path.basename(resolved) === '__init__.py') {
    resolved = _tryNamespaceSubmodule(path.dirname(resolved), ctx) || resolved;
  }

  if (ctx.outMeta) {
    // Inference class (a bare import naming an off-root workspace file) —
    // tier2 alongside symbol-table, not the tier1 path-existence tier.
    ctx.outMeta.method = 'python-module-index';
    ctx.outMeta.confidence = nearest ? MODULE_INDEX_CONFIDENCE.NEAREST : MODULE_INDEX_CONFIDENCE.EXACT;
    ctx.outMeta.tier = 'tier2';
  }
  return resolved;
}

module.exports = {
  tryPythonRelative,
  tryPythonAbsolute,
  tryPythonModuleIndex,
  buildPythonModuleIndex,
  isExternalPythonImport,
};
