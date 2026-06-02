const { DEFAULTS } = require('../../config/constants');

function affectedRoutes(args, container, filePath) {
  const routes = container.snapshot.graph.findAffectedRoutes(filePath, args?.maxDepth);
  return {
    ok: true,
    file: args.file,
    resolvedPath: container.snapshot.graph._displayPath?.(filePath) || filePath,
    maxDepth: args?.maxDepth ?? DEFAULTS.AFFECTED_TEST_DEPTH,
    routesCount: routes.length,
    routes,
  };
}

module.exports = affectedRoutes;
