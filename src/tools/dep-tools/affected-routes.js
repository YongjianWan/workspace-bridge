const { DEFAULTS } = require('../../config/constants');
const { truncateArray } = require('../../utils/truncate');

function affectedRoutes(args, container, filePath) {
  const routes = container.snapshot.graph.findAffectedRoutes(filePath, args?.maxDepth);
  const trunc = truncateArray(routes, DEFAULTS.JSON_OUTPUT_MAX_AFFECTED_ROUTES_ITEMS);
  return {
    ok: true,
    file: args.file,
    resolvedPath: container.snapshot.graph._displayPath?.(filePath) || filePath,
    maxDepth: args?.maxDepth ?? DEFAULTS.AFFECTED_TEST_DEPTH,
    routesCount: routes.length,
    routes: trunc.items,
    truncated: trunc.truncated,
  };
}

module.exports = affectedRoutes;
