const { DEFAULTS } = require('../../config/constants');
const { truncateArray } = require('../../utils/truncate');

// A test reached only through a file that nearly every test imports (a shared
// `testing.py`, a barrel) is weak evidence: the hub links it to everything.
// The widest fan-in among the intermediate files on its path measures that.
function hubFanIn(row, graph) {
  let widest = 0;
  for (const via of (row.via || []).slice(1)) {
    widest = Math.max(widest, graph.getDependents(via).length);
  }
  return widest;
}

function affectedTests(args, container, filePath) {
  // Sort before cutting so a truncated list keeps the strongest evidence:
  // nearest first, then tests behind narrower intermediates; the path
  // tiebreak makes the order identical on cold and warm runs.
  const graph = container.snapshot.graph;
  const ranked = graph.findAffectedTests(filePath, args?.maxDepth)
    .map((row) => ({ row, hub: hubFanIn(row, graph) }))
    .sort((a, b) => (a.row.distance - b.row.distance) || (a.hub - b.hub) || String(a.row.file).localeCompare(String(b.row.file)));
  const affectedTests = ranked.map((r) => r.row);
  // --max-files lets callers cap the returned list below the
  // default. The dedicated command defaults to its own (generous) limit —
  // see AFFECTED_TESTS_COMMAND_MAX_ITEMS for why the digest cap is wrong here.
  const limit = Number.isFinite(args?.maxFiles) ? args.maxFiles : DEFAULTS.AFFECTED_TESTS_COMMAND_MAX_ITEMS;
  const trunc = truncateArray(affectedTests, limit);
  return {
    ok: true,
    file: args.file,
    resolvedPath: container.snapshot.graph._displayPath?.(filePath) || filePath,
    maxDepth: args?.maxDepth ?? DEFAULTS.AFFECTED_TEST_DEPTH,
    affectedTestsCount: affectedTests.length,
    affectedTests: trunc.items,
    orderedBy: 'distance,hubFanIn,file',
    truncated: trunc.truncated,
  };
}

module.exports = affectedTests;
