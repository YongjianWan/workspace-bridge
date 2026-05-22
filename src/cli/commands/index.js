/**
 * CLI command registry — commands with special logic live in sibling files;
 * thin pass-through handlers are inlined here to eliminate the 5-line shell
 * proliferation (U8).
 */

const fs = require('fs');
const { dependencyGraph } = require('../../tools/dep-tools');
const { assembleDiff, assembleSecurity, assembleSummary } = require('../../tools/audit-assembler');
const { projectHealth } = require('../../tools/health-tools');
const { runDiagnostics } = require('../../tools/workspace-tools');
const { buildProjectMap } = require('../formatters');
const { buildProjectOverview } = require('../../tools/overview-tools');
const { treeQuery } = require('../../tools/tree-tools');
const { resolveWorkspaceFilePath } = require('../../utils/path');
const { requireFile } = require('./_utils');

// Commands with special lifecycle or branching logic kept as modules.
const auditFile = require('./audit-file');
const debug = require('./debug');
const init = require('./init');
const repl = require('./repl');
const watch = require('./watch');

/**
 * Factory for file-scoped commands that share the boilerplate:
 *   1. require --file
 *   2. resolve and validate path exists
 *   3. call handler
 *   4. optionally set hasFindings
 */
function makeFileCommand(handler, hasFindingsFn) {
  return async (parsed, container) => {
    requireFile(parsed, parsed.command);
    const filePath = resolveWorkspaceFilePath(parsed.file, container.workspaceRoot);
    if (!filePath || !fs.existsSync(filePath)) {
      return { ok: false, error: `File not found: ${parsed.file}`, inProject: false, hasFindings: false };
    }
    const result = await handler(parsed, container, filePath);
    if (hasFindingsFn) result.hasFindings = hasFindingsFn(result);
    return result;
  };
}

const COMMANDS = {
  // L1 — Curated aggregates
  'audit-summary': (parsed, container) => assembleSummary(parsed, container),
  'audit-file': auditFile,
  'audit-diff': (parsed, container) => assembleDiff(parsed, container),
  'audit-overview': async (parsed, container) => {
    const result = await buildProjectOverview(parsed, container);
    if (result.ok !== false) {
      result.hasFindings =
        (result.orphans?.counts?.total || 0) > 0 ||
        (result.hotspots?.length || 0) > 0 ||
        (result.architectureAdvice?.cycleRefactorSuggestions?.length || 0) > 0;
    }
    return result;
  },
  'audit-map': async (parsed, container) => {
    await container.ensureReady();
    const result = buildProjectMap(container.depGraph, { compact: parsed.compact });
    const c = result.summary?.issueCounts || {};
    result.hasFindings =
      (c.deadExports || 0) > 0 ||
      (c.unresolved || 0) > 0 ||
      (c.cycles || 0) > 0 ||
      (c.orphans || 0) > 0 ||
      (c.hotspots || 0) > 0;
    return result;
  },

  // L2 — Targeted analysis
  impact: makeFileCommand(
    (parsed, container) => dependencyGraph({ cwd: parsed.cwd, operation: 'impact', file: parsed.file, maxDepth: Number.isFinite(parsed.maxDepth) ? parsed.maxDepth : undefined }, container),
    (r) => (r.impactCount || 0) > 0
  ),
  'affected-tests': makeFileCommand(
    (parsed, container) => dependencyGraph({ cwd: parsed.cwd, operation: 'affected_tests', file: parsed.file, maxDepth: Number.isFinite(parsed.maxDepth) ? parsed.maxDepth : undefined }, container),
    (r) => (r.affectedTestsCount || 0) > 0
  ),
  dependencies: makeFileCommand(
    (parsed, container) => dependencyGraph({ cwd: parsed.cwd, operation: 'dependencies', file: parsed.file }, container),
    (r) => (r.dependenciesCount || 0) > 0
  ),
  dependents: makeFileCommand(
    (parsed, container) => dependencyGraph({ cwd: parsed.cwd, operation: 'dependents', file: parsed.file }, container),
    (r) => (r.dependentsCount || 0) > 0
  ),
  tree: makeFileCommand(
    (parsed, container, filePath) => treeQuery({ cwd: parsed.cwd, file: filePath, depth: Number.isFinite(parsed.maxDepth) ? parsed.maxDepth : undefined, direction: parsed.direction || 'both' }, container),
    () => false
  ),

  // L3 — Environment & hygiene
  'workspace-info': async (parsed, container) => {
    const result = await dependencyGraph({ cwd: parsed.cwd, operation: 'workspace_info' }, container);
    result.hasFindings = false;
    return result;
  },
  diagnostics: async (parsed, container) => {
    const result = await runDiagnostics({ cwd: parsed.cwd, mode: parsed.mode }, container);
    result.hasFindings = (result.diagnosticsSummary?.total || 0) > 0;
    return result;
  },
  health: async (parsed, container) => {
    const result = await projectHealth({ cwd: parsed.cwd }, container);
    result.hasFindings = (result.healthScoreNumeric?.ratio || 1) < 1;
    return result;
  },
  'audit-security': (parsed, container) => assembleSecurity(parsed, container),

  // L4 — Debug / raw data
  'dead-exports': async (parsed, container) => {
    const result = await dependencyGraph({ cwd: parsed.cwd, operation: 'dead_exports' }, container);
    result.hasFindings = (result.deadExportsCount || 0) > 0;
    return result;
  },
  unresolved: async (parsed, container) => {
    const result = await dependencyGraph({ cwd: parsed.cwd, operation: 'unresolved' }, container);
    result.hasFindings = (result.unresolvedCount || 0) > 0;
    return result;
  },
  cycles: async (parsed, container) => {
    const result = await dependencyGraph({ cwd: parsed.cwd, operation: 'cycles' }, container);
    result.hasFindings = (result.cyclesCount || 0) > 0;
    return result;
  },
  stats: async (parsed, container) => {
    const result = await dependencyGraph({ cwd: parsed.cwd, operation: 'stats' }, container);
    result.hasFindings = false;
    return result;
  },

  // Self-managed (lifecycle handled internally)
  repl,
  watch,
  init,
  debug,
};

const SELF_MANAGED_COMMANDS = new Set(['repl', 'watch', 'init']);

module.exports = { COMMANDS, SELF_MANAGED_COMMANDS };
