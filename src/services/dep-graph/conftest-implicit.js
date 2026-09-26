const { isTestLikeFile, isConftestFile } = require('../../utils/test-detector');

// pytest injects fixtures into tests by parameter name — an import graph has
// no edge from conftest.py to the tests below it. Instead of fabricating import
// edges (which would pollute dependency listings, dead-export importer counts
// and cycle detection), affected-tests / impact re-query this relation at
// query time: conftest.py is modeled as an implicit dependency of every test
// file in its directory and below (P0-10).
//
// Known limits (locked by test/p0-10-pytest-conftest-test.js):
// - No fixture parameter-name matching: an anchor is "a conftest that imports
//   the changed file (directly or transitively)". Over-approximates — tests
//   that never use the fixture are reported too (safe direction: a conftest
//   change does affect its whole scope).
// - Scope = conftest directory prefix × isTestLikeFile: non-test files under
//   tests/ (helpers.py) are reported as well; test-like files outside the
//   subtree are not.
// - Chains longer than maxDepth are missed, same as graph edges.
// - Fixtures loaded from outside the import graph (plugins / pytest_plugins)
//   are invisible — structural analysis, not semantic analysis.

/** Normalized directory prefix (including trailing '/') of a conftest key. */
function conftestDirPrefix(conftestKey) {
  return conftestKey.slice(0, conftestKey.lastIndexOf('/') + 1);
}

/**
 * Expand conftest anchors into implicit dependency rows for the test files
 * under each anchor's directory (recursive).
 *
 * @param {object} dg — graph facade; `dg.graph` keys are normalized path keys
 * @param {Array<{dir: string, hop: number, chain: string[]}>} anchors
 *   dir   — conftest directory prefix incl. trailing '/'
 *   hop   — graph distance from the queried file to the conftest (0 = the
 *           queried file IS the conftest)
 *   chain — path from the queried file to the conftest, ending with the
 *           conftest itself (becomes `via`, self excluded by convention)
 * @param {number} maxDepth — an implicit conftest→test hop counts as 1
 * @returns {Array<{file: string, distance: number, via: string[]}>}
 *   deterministic: graph-key insertion order, closest anchor wins per file
 */
function expandConftestAnchors(dg, anchors, maxDepth) {
  if (anchors.length === 0) return [];
  const best = new Map();
  for (const key of dg.graph.keys()) {
    if (isConftestFile(key)) continue;
    if (!isTestLikeFile(key)) continue;
    for (const anchor of anchors) {
      if (!key.startsWith(anchor.dir)) continue;
      const distance = anchor.hop + 1;
      if (distance > maxDepth) continue;
      const prev = best.get(key);
      if (!prev || distance < prev.distance) {
        best.set(key, { file: key, distance, via: [...anchor.chain] });
      }
    }
  }
  return [...best.values()];
}

/** Anchor for "the queried file itself is a conftest" (direction 1). */
function selfConftestAnchor(conftestKey) {
  return { dir: conftestDirPrefix(conftestKey), hop: 0, chain: [conftestKey] };
}

/**
 * Anchors harvested from impact-radius rows: every conftest row is a hop
 * closer to the queried file. Impact `via` excludes self, so the chain to the
 * conftest is via + conftest itself.
 */
function conftestAnchorsFromImpactRows(rows) {
  const anchors = [];
  for (const r of rows) {
    if (!isConftestFile(r.file)) continue;
    anchors.push({ dir: conftestDirPrefix(r.file), hop: r.level, chain: [...r.via, r.file] });
  }
  return anchors;
}

module.exports = {
  conftestDirPrefix,
  expandConftestAnchors,
  selfConftestAnchor,
  conftestAnchorsFromImpactRows,
  isConftestFile,
};
