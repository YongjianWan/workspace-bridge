/**
 * Dependency graph tools — thin router over operation handlers.
 * Add new operations by creating a file in ./dep-tools/ and registering below.
 */
const { resolveWorkspaceFilePath, normalizePathKey } = require('../utils/path');
const { warningOf } = require('../services/ledger');
const { failure } = require('../utils/failure');

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
  affected_routes: require('./dep-tools/affected-routes'),
  boundaries: require('./dep-tools/boundaries').checkBoundaries,
  smells: require('./dep-tools/smells').checkSmells,
};

// Operations that require a resolved file path
const FILE_REQUIRED = new Set([
  'dependencies', 'dependents', 'impact', 'affected_tests', 'affected_routes',
]);

async function dependencyGraph(args, container) {
  await container.ensureReady();

  const depGraph = container.snapshot?.graph || container.depGraph;
  if (!depGraph) {
    return failure('init_error', 'Dependency graph not available');
  }

  const operation = args?.operation || 'stats';
  const handler = OPERATIONS[operation];
  if (!handler) {
    return failure('validation_error', `Unknown operation: ${operation}`);
  }

  const root = container.workspaceRoot;
  const filePath = args?.file ? normalizePathKey(resolveWorkspaceFilePath(args.file, root)) : null;

  if (FILE_REQUIRED.has(operation) && !filePath) {
    return failure('validation_error', `file is required for ${operation}`);
  }

  const wrappedContainer = container.snapshot ? container : {
    ...container,
    snapshot: { graph: depGraph },
  };

  const result = await handler(args, wrappedContainer, filePath);
  if (FILE_REQUIRED.has(operation) && !depGraph.hasFile(filePath)) {
    const warnings = result.warnings || [];
    if (!warnings.some(warning => warning.type === 'target-not-indexed')) warnings.push(warningOf('target-not-indexed', {
      message: 'Target is not in the source index; an empty result does not establish absence of dependencies or dependents' }));
    result.warnings = warnings;
    result.dataQuality = 'degraded';
    result.hasFindings = true;
  }
  return result;
}

module.exports = {
  dependencyGraph,
};
