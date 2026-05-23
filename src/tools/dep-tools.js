/**
 * Dependency graph tools — thin router over operation handlers.
 * Add new operations by creating a file in ./dep-tools/ and registering below.
 */
const { resolveWorkspaceFilePath, normalizePathKey } = require('../utils/path');

// Operation registry — thin mapping, handlers live in ./dep-tools/
const OPERATIONS = {
  stats: require('./dep-tools/stats'),
  dependencies: require('./dep-tools/dependencies'),
  dependents: require('./dep-tools/dependents'),
  impact: require('./dep-tools/impact'),
  cycles: require('./dep-tools/cycles'),
  dead_exports: require('./dep-tools/dead-exports'),
  unresolved: require('./dep-tools/unresolved'),
  affected_tests: require('./dep-tools/affected-tests'),
};

// Operations that require a resolved file path
const FILE_REQUIRED = new Set([
  'dependencies', 'dependents', 'impact', 'affected_tests',
]);

async function dependencyGraph(args, container) {
  await container.ensureReady();

  const depGraph = container.snapshot?.graph || container.depGraph;
  if (!depGraph) {
    return { ok: false, error: 'Dependency graph not available' };
  }

  const operation = args?.operation || 'stats';
  const handler = OPERATIONS[operation];
  if (!handler) {
    return { ok: false, error: `Unknown operation: ${operation}` };
  }

  const root = container.workspaceRoot;
  const filePath = args?.file ? normalizePathKey(resolveWorkspaceFilePath(args.file, root)) : null;

  if (FILE_REQUIRED.has(operation) && !filePath) {
    return { ok: false, error: `file is required for ${operation}` };
  }

  const wrappedContainer = container.snapshot ? container : {
    ...container,
    snapshot: { graph: depGraph },
  };

  return handler(args, wrappedContainer, filePath);
}

module.exports = {
  dependencyGraph,
};
