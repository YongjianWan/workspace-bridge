#!/usr/bin/env node
// @semantic @slow — ten cold CLI builds, one per language fixture
// Language parity at the edge layer: every supported language must turn a
// minimal "A depends on B" project into at least one edge through its
// *structural* resolver (path arithmetic, package mapping, module path).
//
// Why this exists: L1-4 — C/C++ produced zero edges for months while every
// per-parser unit test stayed green, because nothing asserted the layer that
// actually matters. Parser tests lock extraction; this locks that an import
// becomes an edge. A language gap now fails here on its own, without anyone
// hand-building fixtures to go looking for it (SESSION.md 待办 T1).
//
// Expected RED until T2 lands: the cpp fixture has no structural resolver
// (its resolveStrategies are a copy of the JS chain, and its imports are
// dropped before reaching even that — L1-4). The 'cpp-include' method name is
// the contract T2 must fulfill.
const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');
const { DatabaseSync } = require('node:sqlite');
const { buildFixtures } = require('./fixtures/language-parity/build-fixtures');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

const REPO_ROOT = path.resolve(__dirname, '..');
const CLI_PATH = path.join(REPO_ROOT, 'cli.js');

// Match the parser's own probe (spawn-ast.js resolveParserPython).
function pythonAvailable() {
  const bin = process.platform === 'win32' ? 'python' : 'python3';
  const res = spawnSync(bin, ['--version'], { encoding: 'utf-8' });
  return !res.error && res.status === 0;
}

function buildGraph(dir) {
  const cacheDir = makeTempDir('wb-parity-cache-');
  const res = spawnSync(
    process.execPath,
    [CLI_PATH, 'audit-summary', '--cwd', dir, '--cache-dir', cacheDir, '--quiet', '--json'],
    { encoding: 'utf-8', maxBuffer: 16 * 1024 * 1024 }
  );
  return { cacheDir, res };
}

/** @returns {{total: number, methods: Record<string, number>}} */
function edgeStats(cacheDir) {
  const db = new DatabaseSync(path.join(cacheDir, 'cache.db'), { readOnly: true });
  try {
    const rows = db
      .prepare('SELECT resolution_method m, COUNT(*) c FROM edges GROUP BY resolution_method')
      .all();
    const methods = {};
    let total = 0;
    for (const row of rows) {
      methods[row.m || 'unknown'] = row.c;
      total += row.c;
    }
    return { total, methods };
  } finally {
    db.close();
  }
}

const hasPython = pythonAvailable();
const fixturesRoot = makeTempDir('wb-parity-fixtures-');
const results = [];
const failures = [];

try {
  for (const fixture of buildFixtures(fixturesRoot)) {
    const { cacheDir, res } = buildGraph(fixture.dir);
    let line;
    if (res.status !== 0) {
      line = `${fixture.language}: BUILD FAILED (exit ${res.status}) ${(res.stderr || '').slice(0, 200)}`;
      failures.push(line);
    } else {
      const { total, methods } = edgeStats(cacheDir);
      const structuralHits = fixture.expectedMethods.reduce((n, m) => n + (methods[m] || 0), 0);
      const methodList = Object.entries(methods).map(([m, c]) => `${m}:${c}`).join(' ') || '(none)';
      line = `${fixture.language}: ${total} edges [${methodList}]`;
      if (total < 1 || structuralHits < 1) {
        const envSkip = fixture.needsPython && !hasPython;
        if (envSkip) {
          // Toolchain degradation must not masquerade as a language defect:
          // the AST parser spawns Python and this machine has none (spawn-ast.js).
          line += ' — SKIP (python not on PATH, parser degraded to regex)';
          console.warn(`[language-parity] ${line}`);
          cleanupTempDir(cacheDir);
          results.push(line);
          continue;
        }
        line += ` — FAIL (need >= 1 edge via ${fixture.expectedMethods.join('/')})`;
        failures.push(line);
      }
    }
    cleanupTempDir(cacheDir);
    results.push(line);
  }
} finally {
  cleanupTempDir(fixturesRoot);
}

console.log('[language-parity] per-language edge production:');
for (const line of results) console.log(`  ${line}`);

// TODO(T5): also assert import_records dropped count === 0 per fixture once
// builder.js accumulates droppedImports — a dropped import is currently
// invisible here unless it takes the edge count to zero (L2-13).

assert.strictEqual(
  failures.length,
  0,
  `language parity failures:\n${failures.join('\n')}`
);
