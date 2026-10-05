#!/usr/bin/env node
// @fast
// @semantic
/**
 * Imports under src/ point down the layers: utils/config/models -> services -> tools -> cli.
 * Inside services the order is storage and index (cache, graph-db, file-index, ledger) ->
 * dependency-graph engine (dep-graph, orchestrator) -> assembly (container, diagnostics-engine).
 * Every import that points up is listed in EXCEPTIONS with the reason it stays; a new one fails.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const REQUIRE_CALL = /require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;

const STORAGE_FILES = new Set(['cache.js', 'cache-prune.js', 'graph-db.js', 'file-index.js', 'ledger.js']);

function layerOf(rel) {
  const [top, second] = rel.split('/');
  if (['utils', 'config', 'models'].includes(top)) return 0;
  if (top === 'services') {
    if (second === 'dep-graph' || second === 'dep-graph.js' || second === 'orchestrator.js') return 2;
    return STORAGE_FILES.has(second) ? 1 : 3;
  }
  if (top === 'adapters') return 1;
  if (top === 'tools') return 4;
  if (top === 'cli') return 5;
  return 6; // cli.js and anything else at the top
}

// Imports that point up on purpose.
const EXCEPTIONS = new Map([
  // Container initialisation precomputes the overview and co-change data so the first query is
  // warm; the work lives in the tool layer because it is the same code a query would run.
  ['services/container.js -> tools/overview-tools.js', 'precompute at initialisation'],
  ['services/container.js -> tools/cochange-tools.js', 'precompute at initialisation'],
  // The file index asks the parser registry which extensions are source files; the registry is
  // a table with no dependencies of its own.
  ['services/file-index.js -> services/dep-graph/parsers/registry.js', 'extension table'],
]);

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

function resolveImport(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier);
  for (const candidate of [base, `${base}.js`, path.join(base, 'index.js')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const upward = new Set();
for (const file of sourceFiles(SRC)) {
  const rel = path.relative(SRC, file).split(path.sep).join('/');
  const code = fs.readFileSync(file, 'utf8');
  for (const match of code.matchAll(REQUIRE_CALL)) {
    const target = resolveImport(file, match[1]);
    if (!target) continue;
    const targetRel = path.relative(SRC, target).split(path.sep).join('/');
    if (layerOf(rel) < layerOf(targetRel)) upward.add(`${rel} -> ${targetRel}`);
  }
}

const unexpected = [...upward].filter((edge) => !EXCEPTIONS.has(edge));
assert.deepStrictEqual(unexpected, [], `imports that point up the layers:\n  ${unexpected.join('\n  ')}`);
const stale = [...EXCEPTIONS.keys()].filter((edge) => !upward.has(edge));
assert.deepStrictEqual(stale, [], `listed exceptions that no longer exist (remove them):\n  ${stale.join('\n  ')}`);
