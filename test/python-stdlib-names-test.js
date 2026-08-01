#!/usr/bin/env node
// @semantic
/**
 * L3-15: Python stdlib classification must come from the interpreter's own
 * sys.stdlib_module_names (~290 names, version-correct by construction), not
 * from the hand-copied fallback list (~150 names, bitten three times: v11,
 * v17 __future__/tomllib/zoneinfo).
 *
 * The fallback set is still required for the python-missing degraded path, so
 * it is exported by the new module and used here as the diff baseline.
 */
const assert = require('assert');
const path = require('path');
const {
  getPythonStdlibNames,
  PYTHON_STDLIB_FALLBACK,
} = require('../src/services/dep-graph/resolvers/python-stdlib');
const { isExternalDependency } = require('../src/services/dep-graph/resolvers');

const root = path.resolve(__dirname, '..');

function testAuthoritativeNamesExceedFallback() {
  const names = getPythonStdlibNames(root);
  assert(names instanceof Set, 'must return a Set');
  // The interpreter on any supported dev/CI machine is >= 3.10 (the version
  // that introduced sys.stdlib_module_names), so the fetch must succeed here
  // and beat the hand-copied list by a wide margin.
  assert.notStrictEqual(names, PYTHON_STDLIB_FALLBACK, 'fetch must succeed on this machine (python >= 3.10 present)');
  const extra = [...names].filter((n) => !PYTHON_STDLIB_FALLBACK.has(n));
  assert(
    extra.length >= 50,
    `authoritative list must contribute >= 50 names beyond the fallback, got ${extra.length}`
  );
}

function testClassificationUsesAuthoritativeNames() {
  const names = getPythonStdlibNames(root);
  const extra = [...names].filter((n) => !PYTHON_STDLIB_FALLBACK.has(n) && !n.startsWith('_'));
  assert(extra.length > 0, 'need at least one public authoritative-only name for this probe');
  const probe = `${extra[0]}.submodule`;
  assert.strictEqual(
    isExternalDependency(probe, '.py', root),
    true,
    `'${probe}' is stdlib per the interpreter but was NOT in the hand-copied list — must classify external`
  );
}

function testMemoizedPerProcess() {
  assert.strictEqual(getPythonStdlibNames(root), getPythonStdlibNames(root), 'second call must return the memoized Set');
}

function testFallbackStillCoversHistoricalBites() {
  for (const name of ['__future__', 'tomllib', 'zoneinfo']) {
    assert(PYTHON_STDLIB_FALLBACK.has(name), `fallback must retain '${name}' (python-missing degraded path)`);
  }
}

function main() {
  testAuthoritativeNamesExceedFallback();
  testClassificationUsesAuthoritativeNames();
  testMemoizedPerProcess();
  testFallbackStillCoversHistoricalBites();
  console.log('python-stdlib-names-test: all tests passed');
}

main();
