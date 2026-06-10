const { DEFAULTS } = require('../../config/constants');
const { truncateArray } = require('../../utils/truncate');

function affectedTests(args, container, filePath) {
  const affectedTests = container.snapshot.graph.findAffectedTests(filePath, args?.maxDepth);
  const trunc = truncateArray(affectedTests, DEFAULTS.JSON_OUTPUT_MAX_AFFECTED_TESTS_ITEMS);
  return {
    ok: true,
    file: args.file,
    resolvedPath: container.snapshot.graph._displayPath?.(filePath) || filePath,
    maxDepth: args?.maxDepth ?? DEFAULTS.AFFECTED_TEST_DEPTH,
    affectedTestsCount: affectedTests.length,
    affectedTests: trunc.items,
    truncated: trunc.truncated,
  };
}

module.exports = affectedTests;
