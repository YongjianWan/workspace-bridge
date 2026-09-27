const { DEFAULTS } = require('../../config/constants');
const { truncateArray } = require('../../utils/truncate');

function affectedTests(args, container, filePath) {
  // Sort before cutting so a truncated list keeps the nearest tests; the path
  // tiebreak makes the order identical on cold and warm runs.
  const affectedTests = [...container.snapshot.graph.findAffectedTests(filePath, args?.maxDepth)]
    .sort((a, b) => (a.distance - b.distance) || String(a.file).localeCompare(String(b.file)));
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
    orderedBy: 'distance,file',
    truncated: trunc.truncated,
  };
}

module.exports = affectedTests;
