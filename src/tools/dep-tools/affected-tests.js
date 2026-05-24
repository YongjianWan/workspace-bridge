const { DEFAULTS } = require('../../config/constants');

function affectedTests(args, container, filePath) {
  const affectedTests = container.snapshot.graph.findAffectedTests(filePath, args?.maxDepth);
  return {
    ok: true,
    file: args.file,
    resolvedPath: container.snapshot.graph._displayPath?.(filePath) || filePath,
    maxDepth: args?.maxDepth ?? DEFAULTS.AFFECTED_TEST_DEPTH,
    affectedTestsCount: affectedTests.length,
    affectedTests,
  };
}

module.exports = affectedTests;
