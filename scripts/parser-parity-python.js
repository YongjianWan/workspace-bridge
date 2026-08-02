#!/usr/bin/env node
/**
 * Python parser parity comparator — L3-9 migration harness.
 *
 * Usage:
 *   node scripts/parser-parity-python.js <path> [<path> ...]
 *   node scripts/parser-parity-python.js --json reference/CodeGraphContext test/fixtures/tricky
 *
 * For every .py file under the given roots it runs BOTH Python parsers and
 * deep-compares the results after identical normalization
 * (normalizePythonAstResult in src/services/dep-graph/parsers/python.js):
 *   old: spawn scripts/python_ast_parser.py (CPython ast, per-file process)
 *   new: src/services/dep-graph/parsers/python-ast.js (tree-sitter WASM)
 *
 * Compared fields: imports, exports, importRecords, exportRecords,
 * functionRecords (incl. fingerprint numerics, decorators, returnType,
 * isExported, hasParameterTypeHints, branchCount, maxArms).
 *
 * Zero diff is the migration's acceptance gate — reached 2026-08-02 on
 * reference/CodeGraphContext + reference/code-review-graph + fixtures
 * (437 files, zero diff), after which scripts/python_ast_parser.py was
 * deleted. This harness is kept as the migration record; without the old
 * script it reports oldParseFailed. The single documented exception is
 * `hasParameterTypeHints` driven by `# type:` comments (CPython parses them
 * with type_comments=True; tree-sitter cannot see them) — those diffs are
 * counted separately as typeCommentSuspected.
 *
 * Exit codes: 0 = zero diff, 1 = diffs found, 2 = usage/env error,
 * 3 = new parser (python-ast.js) not available.
 */

const fs = require('fs');
const path = require('path');
const { spawnPythonASTParser } = require('../src/services/dep-graph/parsers/spawn-ast');
const { normalizePythonAstResult } = require('../src/services/dep-graph/parsers/python');

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const roots = args.filter((a) => !a.startsWith('--'));

if (roots.length === 0) {
  console.error('usage: node scripts/parser-parity-python.js [--json] <path> [<path> ...]');
  process.exit(2);
}

let parsePythonAstNew = null;
try {
  parsePythonAstNew = require('../src/services/dep-graph/parsers/python-ast').parsePythonAst;
} catch {
  // RED state of the migration harness: the tree-sitter parser does not exist yet.
}
if (typeof parsePythonAstNew !== 'function') {
  console.error('new parser missing: src/services/dep-graph/parsers/python-ast.js has no parsePythonAst()');
  process.exit(3);
}

const SKIP_DIRS = new Set(['.git', 'node_modules', '__pycache__', '.venv', 'venv', '.tox', '.mypy_cache']);

function collectPyFiles(root, out) {
  const stat = fs.statSync(root);
  if (stat.isFile()) {
    if (root.endsWith('.py')) out.push(root);
    return out;
  }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      collectPyFiles(path.join(root, entry.name), out);
    } else if (entry.isFile() && entry.name.endsWith('.py')) {
      out.push(path.join(root, entry.name));
    }
  }
  return out;
}

/** Stable stringify: object keys sorted, array order preserved. */
function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
}

/** First differing leaf path between two values, or null. */
function firstDiff(a, b, trail = '') {
  if (stable(a) === stable(b)) return null;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) {
    return { path: trail || '(root)', old: a, new: b };
  }
  if (Array.isArray(a)) {
    if (a.length !== b.length) return { path: `${trail}.length`, old: a.length, new: b.length };
    for (let i = 0; i < a.length; i++) {
      const d = firstDiff(a[i], b[i], `${trail}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const d = firstDiff(a[k], b[k], trail ? `${trail}.${k}` : k);
    if (d) return d;
  }
  return null;
}

const COMPARE_FIELDS = ['imports', 'exports', 'importRecords', 'exportRecords', 'functionRecords'];

/** Per-field diffs between two normalized results; null when identical. */
function diffResults(oldR, newR) {
  const diffs = [];
  for (const field of COMPARE_FIELDS) {
    const d = firstDiff(oldR[field], newR[field], field);
    if (d) diffs.push(d);
  }
  return diffs.length > 0 ? diffs : null;
}

/** A diff where the ONLY differing leaf anywhere is hasParameterTypeHints. */
function isTypeCommentOnlyDiff(diffs) {
  return diffs.every((d) => d.path.endsWith('.hasParameterTypeHints'));
}

async function main() {
  const files = [];
  for (const root of roots) {
    const abs = path.resolve(root);
    if (!fs.existsSync(abs)) {
      console.error(`skip ${root}: not found`);
      continue;
    }
    collectPyFiles(abs, files);
  }
  if (files.length === 0) {
    console.error('no .py files found under the given roots');
    process.exit(2);
  }

  const summary = {
    files: files.length,
    identical: 0,
    diffed: 0,
    typeCommentSuspected: 0,
    oldParseFailed: [],
    diffs: [],
  };

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const root = path.dirname(file);

    const oldRaw = await spawnPythonASTParser('python_ast_parser.py', content, undefined, root);
    if (!oldRaw) {
      summary.oldParseFailed.push(file);
      continue;
    }
    const newRaw = await parsePythonAstNew(content, root);
    if (!newRaw) {
      summary.diffs.push({ file, diffs: [{ path: '(whole result)', old: 'ast result', new: 'null (fell back)' }] });
      summary.diffed++;
      continue;
    }

    const oldN = normalizePythonAstResult(oldRaw);
    const newN = normalizePythonAstResult(newRaw);
    const diffs = diffResults(oldN, newN);
    if (!diffs) {
      summary.identical++;
    } else {
      summary.diffed++;
      if (isTypeCommentOnlyDiff(diffs)) summary.typeCommentSuspected++;
      summary.diffs.push({ file, diffs });
    }
  }

  if (asJson) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(
      `files=${summary.files} identical=${summary.identical} diffed=${summary.diffed}` +
        ` (typeCommentSuspected=${summary.typeCommentSuspected}) oldParseFailed=${summary.oldParseFailed.length}`
    );
    const shown = summary.diffs.slice(0, 20);
    for (const d of shown) {
      console.log(`\n### ${d.file}`);
      for (const leaf of d.diffs.slice(0, 5)) {
        console.log(`  ${leaf.path}`);
        console.log(`    old: ${JSON.stringify(leaf.old)}`);
        console.log(`    new: ${JSON.stringify(leaf.new)}`);
      }
    }
    if (summary.diffs.length > shown.length) {
      console.log(`\n… 另有 ${summary.diffs.length - shown.length} 个文件有 diff（--json 看全量）`);
    }
  }

  if (summary.oldParseFailed.length > 0) process.exit(2);
  process.exit(summary.diffed - summary.typeCommentSuspected > 0 ? 1 : summary.diffed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err.stack || String(err));
  process.exit(2);
});
