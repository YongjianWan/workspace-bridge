#!/usr/bin/env node
/**
 * Java parser parity comparator — L3-9 Java half migration harness.
 *
 * Usage:
 *   node scripts/parser-parity-java.js <path> [<path> ...]
 *   node scripts/parser-parity-java.js --json reference/spring-petclinic test/fixtures
 *
 * For every .java file under the given roots it runs BOTH Java parsers and
 * deep-compares their RAW result shapes (both emit the same parser JSON
 * contract, so no normalization step is needed — unlike the Python half,
 * java.js drops fields on the way out and comparing post-normalization would
 * stop verifying returnType / isExported / hasParameterTypeHints):
 *   old: spawn scripts/java_ast_parser.py (javalang, per-file process)
 *   new: src/services/dep-graph/parsers/java-ast.js (tree-sitter WASM)
 *
 * Compared fields: package, imports, exports, importRecords, exportRecords,
 * functionRecords (incl. fingerprint numerics, decorators, returnType,
 * lineStart/lineEnd, isExported, hasParameterTypeHints).
 *
 * IMPORTANT — the oracle has a hard ceiling. javalang 0.13.0 (last release
 * 2020) cannot parse record(16) / sealed(17) / text block(15) / switch
 * expression(14) / instanceof pattern(16). Those files land in
 * `oracleCannotParse`, NOT in the diff count: there is nothing to compare
 * against, and reading them at all is the whole point of the migration.
 * Their expected output is locked by contract tests instead
 * (test/java-tree-sitter-modern-syntax-test.js), not by this harness.
 *
 * Exit codes: 0 = zero diff, 1 = diffs found, 2 = usage/env error,
 * 3 = new parser (java-ast.js) not available.
 */

const fs = require('fs');
const path = require('path');

let spawnPythonASTParser = null;
try {
  const spawnAstPath = '../src/services/dep-graph/parsers/' + 'spawn-ast';
  spawnPythonASTParser = require(spawnAstPath).spawnPythonASTParser;
} catch (_) {
  // Spawn parser not available (e.g. after spawn-ast.js cleanup)
}

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const roots = args.filter((a) => !a.startsWith('--'));

if (roots.length === 0) {
  console.error('usage: node scripts/parser-parity-java.js [--json] <path> [<path> ...]');
  process.exit(2);
}

let parseJavaAstNew = null;
try {
  parseJavaAstNew = require('../src/services/dep-graph/parsers/java-ast').parseJavaAst;
} catch {
  // RED state of the migration harness: the tree-sitter parser does not exist yet.
}
if (typeof parseJavaAstNew !== 'function') {
  console.error('new parser missing: src/services/dep-graph/parsers/java-ast.js has no parseJavaAst()');
  process.exit(3);
}

const SKIP_DIRS = new Set(['.git', 'node_modules', 'build', 'target', 'out']);

function collectJavaFiles(root, out) {
  const stat = fs.statSync(root);
  if (stat.isFile()) {
    if (root.endsWith('.java')) out.push(root);
    return out;
  }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      collectJavaFiles(path.join(root, entry.name), out);
    } else if (entry.isFile() && entry.name.endsWith('.java')) {
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
  if (
    a === null || b === null ||
    typeof a !== 'object' || typeof b !== 'object' ||
    Array.isArray(a) !== Array.isArray(b)
  ) {
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

const COMPARE_FIELDS = [
  'package',
  'imports',
  'exports',
  'importRecords',
  'exportRecords',
  'functionRecords',
];

/** The oracle omits array fields entirely on empty input; [] is the same thing. */
function fieldValue(result, field) {
  const raw = result[field];
  if (raw !== undefined) return raw;
  return field === 'package' ? null : [];
}

/** Per-field diffs between two raw results; null when identical. */
function diffResults(oldR, newR) {
  const diffs = [];
  for (const field of COMPARE_FIELDS) {
    const d = firstDiff(fieldValue(oldR, field), fieldValue(newR, field), field);
    if (d) diffs.push(d);
  }
  return diffs.length > 0 ? diffs : null;
}

/**
 * The single documented intentional divergence: javalang has no
 * `AnnotationTypeDeclaration` node class (it is `AnnotationDeclaration`), so
 * java_ast_parser.py's branch for it was dead and `@interface Foo` produced no
 * export — while java.js's regex fallback has always emitted one. java-ast.js
 * emits it. A file whose ONLY diff is the extra annotation export is counted
 * here instead of failing the gate.
 */
function isAnnotationExportOnlyDiff(oldR, newR) {
  const extra = new Set(
    (newR.exportRecords || [])
      .filter((r) => r.kind === 'annotation')
      .map((r) => r.name)
  );
  if (extra.size === 0) return false;
  const strip = (result) => ({
    package: fieldValue(result, 'package'),
    imports: fieldValue(result, 'imports'),
    exports: fieldValue(result, 'exports').filter((n) => !extra.has(n)),
    importRecords: fieldValue(result, 'importRecords'),
    exportRecords: fieldValue(result, 'exportRecords').filter(
      (r) => !(r.kind === 'annotation' && extra.has(r.name))
    ),
    functionRecords: fieldValue(result, 'functionRecords'),
  });
  return diffResults(strip(oldR), strip(newR)) === null;
}

async function main() {
  console.log('main() started with roots:', roots);
  const files = [];
  for (const root of roots) {
    const abs = path.resolve(root);
    if (!fs.existsSync(abs)) {
      console.error(`skip ${root}: not found`);
      continue;
    }
    collectJavaFiles(abs, files);
  }
  console.log('files found count:', files.length);
  if (files.length === 0) {
    console.error('no .java files found under the given roots');
    process.exit(2);
  }

  const summary = {
    files: files.length,
    identical: 0,
    diffed: 0,
    annotationExportOnly: 0,
    oracleCannotParse: [],
    newParserNull: [],
    diffs: [],
  };

  for (const file of files) {
    console.log('processing file:', file);
    const content = fs.readFileSync(file, 'utf8');
    const root = path.dirname(file);

    let oldRaw = null;
    if (spawnPythonASTParser) {
      try {
        oldRaw = await spawnPythonASTParser('java_ast_parser.py', content, undefined, root);
      } catch (e) {
        console.error('CRITICAL: spawnPythonASTParser threw:', e.stack || String(e));
        process.exit(1);
      }
    }
    if (!oldRaw) {
      // javalang refused the file (syntax beyond Java 8, or toolchain missing, or spawn-ast cleaned up).
      summary.oracleCannotParse.push(file);
      continue;
    }
    const newRaw = await parseJavaAstNew(content, root);
    if (!newRaw) {
      summary.newParserNull.push(file);
      summary.diffed++;
      continue;
    }

    const diffs = diffResults(oldRaw, newRaw);
    if (!diffs) {
      summary.identical++;
    } else if (isAnnotationExportOnlyDiff(oldRaw, newRaw)) {
      summary.annotationExportOnly++;
    } else {
      summary.diffed++;
      summary.diffs.push({ file, diffs });
    }
  }

  if (asJson) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(
      `files=${summary.files} identical=${summary.identical} diffed=${summary.diffed}` +
        ` (annotationExportOnly=${summary.annotationExportOnly})` +
        ` oracleCannotParse=${summary.oracleCannotParse.length} newParserNull=${summary.newParserNull.length}`
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

  process.exit(summary.diffed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err.stack || String(err));
  process.exit(2);
});
