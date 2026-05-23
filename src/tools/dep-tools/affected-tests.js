const { DEFAULTS } = require('../../config/constants');

function affectedTests(args, container, filePath) {
  const maxDepth = Number.isFinite(args?.maxDepth) ? Math.max(1, args.maxDepth) : DEFAULTS.AFFECTED_TEST_DEPTH;
  const affectedTests = container.snapshot.graph.findAffectedTests(filePath, maxDepth);
  return {
    ok: true,
    file: args.file,
    resolvedPath: container.snapshot.graph._displayPath?.(filePath) || filePath,
    maxDepth,
    affectedTestsCount: affectedTests.length,
    affectedTests,
  };
}

module.exports = affectedTests;
