/**
 * CLI command registry — commands with special logic live in sibling files;
 * thin pass-through handlers are inlined here to eliminate the 5-line shell
 * proliferation (U8).
 */

const fs = require('fs');
const { dependencyGraph } = require('../../tools/dep-tools');
const { assembleDiff, assembleSecurity, assembleSummary } = require('../../tools/audit-assembler');
const { projectHealth } = require('../../tools/health-tools');
const { runDiagnostics, workspaceInfo } = require('../../tools/workspace-tools');
const { buildProjectMap } = require('../formatters');
const { buildProjectOverview } = require('../../tools/overview-tools');
const { treeQuery } = require('../../tools/tree-tools');
const { resolveWorkspaceFilePath } = require('../../utils/path');
const { requireFile } = require('./_utils');
const { DEFAULTS } = require('../../config/constants');

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
        (result.architectureAdvice?.cycleRefactorSuggestions?.length || 0) > 0 ||
        (result.knowledgeRisk?.high?.length || 0) > 0;
    }
    return result;
  },
  'audit-map': async (parsed, container) => {
    await container.ensureReady();
    const result = buildProjectMap(container.snapshot.graph, { compact: parsed.compact });
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
    (parsed, container) => dependencyGraph({ cwd: parsed.cwd, operation: 'impact', file: parsed.file, maxDepth: parsed.maxDepth ?? DEFAULTS.AFFECTED_TEST_DEPTH }, container),
    (r) => (r.impactCount || 0) > 0
  ),
  'affected-tests': makeFileCommand(
    (parsed, container) => dependencyGraph({ cwd: parsed.cwd, operation: 'affected_tests', file: parsed.file, maxDepth: parsed.maxDepth ?? DEFAULTS.AFFECTED_TEST_DEPTH }, container),
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
    (parsed, container, filePath) => treeQuery({ cwd: parsed.cwd, file: filePath, depth: parsed.maxDepth ?? 3, direction: parsed.direction || 'both' }, container),
    () => false
  ),

  // L3 — Environment & hygiene
  'workspace-info': async (parsed, container) => {
    const result = workspaceInfo({ cwd: parsed.cwd }, container);
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

const COMMAND_GUIDES = {
  'workspace-info': {
    desc: 'Detect workspace type and root',
    when: 'First step when exploring an unknown repo. Confirm root, stack, and package manager before deeper analysis.',
    after: 'audit-summary or audit-overview for the full picture.',
  },
  diagnostics: {
    desc: 'Run quick/full diagnostics (eslint, tsc, pyright, etc.)',
    when: 'Before committing, or when CI is failing and you want local repro.',
    after: 'audit-file --file <path> if errors are localized to one file.',
  },
  'audit-summary': {
    desc: 'Aggregate health + dead-exports + unresolved + cycles',
    when: 'First look at a repo. Gives the "health snapshot" in one command.',
    after: 'audit-overview for structural skeleton, or audit-map for full graph.',
  },
  'audit-file': {
    desc: 'Aggregate impact + affected tests for one file',
    when: 'Before/after editing a single file. Know what breaks before you save.',
    after: 'impact --file <path> for deeper transitive analysis, or affected-tests for test mapping. Add --watch to auto-re-run on every save.',
  },
  'audit-diff': {
    desc: 'Aggregate changed files + impact + affected tests + history risk',
    when: 'Reviewing a PR or preparing a commit. Understand the blast radius of current worktree changes.',
    after: 'audit-file --file <path> for any high-risk file that needs individual attention. Add --incremental to suppress unrelated findings.',
  },
  'audit-overview': {
    desc: 'Project panoramic view (hotspots, stability, orphans, core modules)',
    when: 'Taking over a repo for the first time. Identify where the fire is before touching code.',
    after: 'audit-map --compact for a navigable tree, or repl for precise queries.',
  },
  'audit-map': {
    desc: 'Global project map (tree + edges + issue overlay)',
    when: 'Need the full graph. Use --compact on large repos (>500 files) to avoid output explosion.',
    after: 'impact --file <path> or repl for targeted exploration of specific files.',
  },
  health: {
    desc: 'Summarize project health (CI, tests, config, deps)',
    when: 'Quick gut-check on repo hygiene. Faster than audit-summary when you only care about health.',
    after: 'audit-security if health flags missing security checks.',
  },
  'audit-security': {
    desc: 'Run external security scanners (Semgrep)',
    when: 'Security review, before releases, or when health flags missing security tools.',
    after: 'audit-diff to see if recent changes touched code near security findings.',
  },
  repl: {
    desc: 'Start interactive REPL shell, or run one command non-interactively with --eval',
    when: 'Large projects where CLI startup is too slow. Dep-graph stays hot in memory; queries <100ms. Use --eval for CI/AI agent integration.',
    after: 'Any atomic command (impact, dependencies, dead-exports) inside the REPL.',
  },
  watch: {
    desc: 'Watch files and print impact on save',
    when: 'Active development. Save a file → immediately see affected dependents.',
    after: 'affected-tests --file <path> if you need the full test mapping after seeing impact.',
  },
  stats: {
    desc: 'Show dependency graph statistics',
    layer: 'debug',
    when: 'Need raw numbers (files, edges, cycles) without the full audit-map payload.',
    after: 'audit-map --compact if the numbers look suspicious and you need visual confirmation.',
  },
  dependencies: {
    desc: 'List direct dependencies of a file',
    layer: 'debug',
    when: 'Debugging "why is this file here?" or tracing imports inward.',
    after: 'dependents --file <path> for the reverse direction (who imports me).',
  },
  dependents: {
    desc: 'List direct dependents of a file',
    layer: 'debug',
    when: 'Before deleting or renaming a file. Know who imports you.',
    after: 'impact --file <path> for transitive dependents (not just direct).',
  },
  'dead-exports': {
    desc: 'Find dead export candidates',
    layer: 'debug',
    when: 'Cleanup phase. Remove unused code to reduce maintenance surface.',
    after: 'audit-file --file <path> on any dead-export candidate to confirm it is truly unused.',
  },
  unresolved: {
    desc: 'Find unresolved imports',
    layer: 'debug',
    when: 'Build is broken, or after moving/renaming files. Fix broken paths.',
    after: 'audit-diff to verify the fix did not introduce new unresolved imports.',
  },
  cycles: {
    desc: 'Find circular dependencies',
    layer: 'debug',
    when: 'Architecture review, or before refactoring layered code.',
    after: 'audit-file --file <path> on any file in the cycle to plan the break point.',
  },
  impact: {
    desc: 'Find impact radius for a file',
    when: 'Before risky changes. See the full transitive blast radius (not just direct dependents).',
    after: 'affected-tests --file <path> to map the impacted area to specific tests.',
  },
  'affected-tests': {
    desc: 'Find tests related to a file',
    when: 'Before/after changes. Know which tests to run or update.',
    after: 'impact --file <path> if test mapping is empty (heuristic may miss cross-stack tests).',
  },
};

for (const [name, guide] of Object.entries(COMMAND_GUIDES)) {
  if (COMMANDS[name]) {
    COMMANDS[name].desc = guide.desc;
    COMMANDS[name].when = guide.when;
    COMMANDS[name].after = guide.after;
    if (guide.layer) COMMANDS[name].layer = guide.layer;
  }
}

module.exports = { COMMANDS, SELF_MANAGED_COMMANDS };
