#!/usr/bin/env node
/**
 * workspace-bridge CLI
 *
 * Keeps the existing analysis engine behind a local CLI so agents
 * can call it directly.
 */
const fs = require('fs');
const path = require('path');
const { version } = require('./package.json');

const SCHEMA_VERSION = '1.2.0';

const SEVERITY_RANK = { high: 3, medium: 2, low: 1 };

function severityMeetsFilter(itemSeverity, minSeverity) {
  if (!minSeverity || !SEVERITY_RANK[minSeverity]) return true;
  return (SEVERITY_RANK[itemSeverity] || 0) >= SEVERITY_RANK[minSeverity];
}

/**
 * Write large JSON strings to stdout in chunks to avoid blocking
 * the event loop on huge strings (e.g. audit-map with 10k+ edges).
 * @param {string} json
 */
async function writeLargeJson(json) {
  if (json.length <= STREAMING.JSON_WRITE_CHUNK_SIZE_BYTES) {
    process.stdout.write(json + '\n');
    return;
  }
  for (let i = 0; i < json.length; i += STREAMING.JSON_WRITE_CHUNK_SIZE_BYTES) {
    const chunk = json.slice(i, i + STREAMING.JSON_WRITE_CHUNK_SIZE_BYTES);
    process.stdout.write(chunk);
    if (i + STREAMING.JSON_WRITE_CHUNK_SIZE_BYTES < json.length) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
  process.stdout.write('\n');
}
const { ServiceContainer } = require('./src/services/container');
const { workspaceInfo, runDiagnostics } = require('./src/tools/workspace-tools');
const { projectHealth } = require('./src/tools/health-tools');
const { dependencyGraph } = require('./src/tools/dep-tools');
const { auditSecurity, groupBySeverity } = require('./src/tools/security-tools');
const { getChangedFiles, getChangedLineRanges, getFileHistoryRisk, getDiffNumstat } = require('./src/tools/git-tools');
const { resolveWorkspaceFilePath, toPosixPath } = require('./src/utils/path');
const {
  buildCompositeRisk,
  buildRepoSummary,
  buildFileSummary,
  buildAuditDiffSummary,
  buildValidationAdvice,
  buildFileValidationAdvice,
  buildProjectMap,
  buildImpactExplanations,
  compactChangedFile,
  formatHuman,
  formatSummary,
  formatMarkdown,
  formatJsonl,
  formatAi,
} = require('./src/cli/formatters');
const { buildProjectOverview } = require('./src/tools/overview-tools');
const { parseArgs } = require('./src/utils/parse-args');
const { TIMEOUTS, DEFAULTS, STREAMING } = require('./src/config/constants');

async function mapWithConcurrency(items, limit, mapper) {
  const safeLimit = Math.max(1, Number.isFinite(limit) ? limit : 1);
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const currentIndex = cursor;
      cursor += 1;
      try {
        results[currentIndex] = await mapper(items[currentIndex], currentIndex);
      } catch (err) {
        results[currentIndex] = {
          __error: err?.message || String(err),
          __item: items[currentIndex],
        };
      }
    }
  }

  const workers = [];
  const workerCount = Math.min(safeLimit, items.length);
  for (let i = 0; i < workerCount; i += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

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

function printCommandHelp(command) {
  const guide = COMMAND_GUIDES[command];
  if (!guide) {
    console.log(`No detailed help for '${command}'. Run without arguments for full command list.`);
    return;
  }
  console.log(`workspace-bridge ${command}

  ${guide.desc}

WHEN TO USE:
  ${guide.when}

AFTER THIS:
  ${guide.after}

Common Options:
  --cwd <path>    Target workspace or file path
  --json          Print machine-readable JSON
  --quiet         Suppress stderr logs during CLI execution
  --help          Show help (or --help <command> for detailed guide)
`);
}

function printUsage() {
  console.log(`workspace-bridge-cli

Usage:
  workspace-bridge-cli <command> [options]

Commands:
  L1 策展入口 (Curated aggregates — AI default):
    audit-summary           Aggregate health + graph findings
    audit-file --file <p> [--watch]  Aggregate impact + affected tests for one file
    audit-diff [--staged] [--files <list>] [--incremental]
                            Aggregate changed files + impact + affected tests
    audit-overview          Project panoramic view (hotspots, stability, orphans)
    audit-map               Global project map (tree + edges + issue overlay)

  L2 专项工具 (Targeted analysis):
    impact --file <path>    Find impact radius for a file
    affected-tests --file <path> [--max-depth <n>]
                            Find tests related to a file

  L3 环境诊断 (Environment & hygiene):
    workspace-info          Detect workspace type and root
    diagnostics             Run quick/full diagnostics
    health                  Summarize project health (deprecated: use audit-summary --health-only)
    audit-security [--files <list>]
                            Run external security scanners (Semgrep)

  L4 原始查询 (Debug / raw data — daily audit uses L1/L2 instead):
    dead-exports            Find dead export candidates
    unresolved              Find unresolved imports
    cycles                  Find circular dependencies
    tree --file <path> [--max-depth <n>] [--direction <imports|dependents|both>]
                            Build import/dependent tree for a file
    dependencies --file <p> List direct dependencies of a file
    dependents --file <p>   List direct dependents of a file
    stats                   Show dependency graph statistics

  其他:
    init                    Create default .workspace-bridge.json in cwd
    repl [--eval <cmd>]     Start interactive REPL shell, or run one command non-interactively
    watch                   Watch files and print impact on save

Options:
  --cwd <path>            Target workspace or file path
  --exclude <paths>       Comma-separated directories, path fragments, or simple globs (*.ext) to exclude
  --eval <command>        Run a single REPL command non-interactively
  --mode <quick|full>     Diagnostics mode (default: quick)
  --file <path>           File path for file-scoped commands
  --max-depth <n>         Max depth for affected-tests (default: 5)
  --reuse-hints <mode>    Reuse hints mode for audit-diff: on|off (default: off)
  --hotspot-data <path>   Write audit-overview hotspot visualization JSON
  --stability-trend-data <path>  Write audit-overview stability trend JSON
  --trend-granularity <mode>  Trend bucket mode for stability trend: day|week (default: day)
  --overview-dashboard <path>  Write audit-overview single-file HTML dashboard
  --json                  Print machine-readable JSON
  --format <mode>         Output format: summary | markdown | jsonl | ai | human (default: markdown)
  --token-budget <n>      Max estimated tokens for --format ai; auto-downgrades depth if exceeded
  --depth <mode>          Discovery depth for --format ai: surface | detail | full (default: detail)
  --quiet                 Suppress stderr logs during CLI execution
  --compact              Emit condensed tree and directory-level edges
  --watch                Watch mode for audit-file: re-run on file changes
  --staged               Only analyze git staged changes in audit-diff
  --files <list>         Comma-separated file list for audit-diff / audit-security
  --incremental          Only show findings related to changed files in audit-diff
  --save <file>          Save audit-summary findings to a JSON baseline file
  --check-regression     Compare current audit-summary against previous baseline
  --baseline <file|commit>  Baseline file or git commit for --check-regression (default: .workspace-bridge-baseline.json)
  --config <name>        Semgrep config (default: auto)
  --language <lang>      Filter security scan to one language
  --help                  Show help
  --help <command>       Show detailed guide for a command
`);
}

function parseCliArgs(argv) {
  const raw = parseArgs(argv, {
    '--cwd': { key: 'cwd' },
    '--exclude': { key: 'exclude' },
    '--mode': { key: 'mode' },
    '--file': { key: 'file' },
    '--max-depth': { key: 'maxDepth', transform: (v) => {
      const n = Number.parseInt(v, 10);
      if (Number.isNaN(n)) throw new Error(`Invalid --max-depth value: ${v}. Expected a positive integer`);
      return n;
    } },
    '--reuse-hints': { key: 'reuseHints' },
    '--hotspot-data': { key: 'hotspotData' },
    '--stability-trend-data': { key: 'stabilityTrendData' },
    '--trend-granularity': { key: 'trendGranularity' },
    '--overview-dashboard': { key: 'overviewDashboard' },
    '--config': { key: 'config' },
    '--language': { key: 'language' },
    '--builtin-only': true,
    '--format': { key: 'format' },
    '--token-budget': { key: 'tokenBudget', transform: (v) => {
      const n = Number.parseInt(v, 10);
      if (Number.isNaN(n) || n <= 0) throw new Error(`Invalid --token-budget value: ${v}. Expected a positive integer`);
      return n;
    } },
    '--depth': { key: 'depth' },
    '--since': { key: 'since' },
    '--severity': { key: 'severity' },
    '--staged': true,
    '--files': { key: 'files' },
    '--json': true,
    '--quiet': true,
    '--compact': true,
    '--watch': true,
    '--incremental': true,
    '--with-impact': true,
    '--save': { key: 'save' },
    '--check-regression': true,
    '--baseline': { key: 'baseline' },
    '--cache-dir': { key: 'cacheDir' },
    '--direction': { key: 'direction' },
    '--eval': { key: 'eval' },
    '--fail-on-findings': true,
    '--run-tests': true,
    '--version': true,
    '-v': true,
    '--help': true,
    '-h': true,
  });

  const command = raw._[0] || null;
  const reuseHints = (raw.reuseHints || 'off').toLowerCase();
  if (reuseHints && !['on', 'off'].includes(reuseHints)) {
    throw new Error(`Invalid --reuse-hints value: ${reuseHints}. Expected on|off`);
  }
  const trendGranularity = (raw.trendGranularity || 'day').toLowerCase();
  if (trendGranularity && !['day', 'week'].includes(trendGranularity)) {
    throw new Error(`Invalid --trend-granularity value: ${trendGranularity}. Expected day|week`);
  }

  if (Number.isFinite(raw.maxDepth) && raw.maxDepth <= 0) {
    throw new Error(`Invalid --max-depth value: ${raw.maxDepth}. Expected a positive integer`);
  }
  if (raw.severity && !['high', 'medium', 'low'].includes(raw.severity)) {
    throw new Error(`Invalid --severity value: ${raw.severity}. Expected high|medium|low`);
  }

  return {
    command,
    cwd: raw.cwd || process.cwd(),
    exclude: raw.exclude
      ? String(raw.exclude)
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
      : [],
    mode: raw.mode || 'quick',
    file: raw.file ? toPosixPath(raw.file) : null,
    maxDepth: Number.isFinite(raw.maxDepth) ? raw.maxDepth : null,
    reuseHints,
    hotspotData: raw.hotspotData || null,
    stabilityTrendData: raw.stabilityTrendData || null,
    trendGranularity,
    overviewDashboard: raw.overviewDashboard || null,
    config: raw.config || null,
    language: raw.language || null,
    builtinOnly: Boolean(raw['--builtin-only']),
    format: raw.format || null,
    since: raw.since || null,
    severity: raw.severity || null,
    staged: Boolean(raw['--staged']),
    files: raw.files || null,
    targets: raw._.slice(1),
    json: Boolean(raw['--json']),
    quiet: Boolean(raw['--quiet']),
    compact: Boolean(raw['--compact']),
    watch: Boolean(raw['--watch']),
    incremental: Boolean(raw['--incremental']),
    withImpact: Boolean(raw['--with-impact']),
    save: raw.save || null,
    checkRegression: Boolean(raw['--check-regression']),
    baseline: raw.baseline || null,
    cacheDir: raw.cacheDir || null,
    direction: raw.direction || null,
    eval: raw.eval || null,
    failOnFindings: Boolean(raw['--fail-on-findings']),
    runTests: Boolean(raw['--run-tests']),
    version: Boolean(raw['--version']) || Boolean(raw['-v']),
    help: Boolean(raw['--help']) || Boolean(raw['-h']),
    depth: raw.depth || null,
    tokenBudget: Number.isFinite(raw.tokenBudget) ? raw.tokenBudget : null,
  };
}

function requireFile(parsed, command) {
  if (!parsed.file) {
    throw new Error(`${command} requires --file <path>`);
  }
}

function validateCwd(parsed) {
  if (parsed.cwd && (!fs.existsSync(parsed.cwd) || !fs.statSync(parsed.cwd).isDirectory())) {
    const error = `Directory not found: ${parsed.cwd}`;
    if (parsed.json) {
      console.log(JSON.stringify({ ok: false, error, schemaVersion: SCHEMA_VERSION }));
    } else {
      console.error(`Error: ${error}`);
    }
    process.exitCode = 1;
    return { ok: false, error };
  }
  return null;
}

function determineExitCode(command, result, failOnFindings = false) {
  if (!result || result.ok === false) return 1;
  if (result.regression && result.regression.ok === false) return 1;

  switch (command) {
    case 'audit-summary': {
      const hasFindings =
        (result.deadExports?.deadExportsCount || 0) > 0 ||
        (result.unresolved?.unresolvedCount || 0) > 0 ||
        (result.cycles?.cyclesCount || 0) > 0 ||
        (result.health?.healthScoreNumeric?.ratio || 1) < 1;
      return failOnFindings && hasFindings ? 1 : 0;
    }
    case 'audit-security':
      return failOnFindings && (result.summary?.total || 0) > 0 ? 1 : 0;
    case 'dead-exports':
      return failOnFindings && (result.deadExportsCount || 0) > 0 ? 1 : 0;
    case 'unresolved':
      return failOnFindings && (result.unresolvedCount || 0) > 0 ? 1 : 0;
    case 'cycles':
      return failOnFindings && (result.cyclesCount || 0) > 0 ? 1 : 0;
    case 'health':
      return failOnFindings && (result.healthScoreNumeric?.ratio || 1) < 1 ? 1 : 0;
    default:
      return 0;
  }
}

async function runCommand(parsed, container) {
  switch (parsed.command) {
    case 'workspace-info':
      return workspaceInfo({ cwd: parsed.cwd }, container);
    case 'diagnostics':
      return runDiagnostics({ cwd: parsed.cwd, mode: parsed.mode }, container);
    case 'audit-summary': {
      const regressionTools = require('./src/tools/regression-tools');
      const [health, deadExports, unresolved, cycles] = await Promise.all([
        projectHealth({ cwd: parsed.cwd }, container),
        dependencyGraph({ cwd: parsed.cwd, operation: 'dead_exports' }, container),
        dependencyGraph({ cwd: parsed.cwd, operation: 'unresolved' }, container),
        dependencyGraph({ cwd: parsed.cwd, operation: 'cycles' }, container),
      ]);
      if (parsed.severity && deadExports.ok && deadExports.deadExports) {
        const filtered = deadExports.deadExports.filter((d) => severityMeetsFilter(d.confidence, parsed.severity));
        deadExports.deadExports = filtered;
        deadExports.deadExportsCount = filtered.length;
        if (deadExports.possibleFalsePositives) {
          deadExports.possibleFalsePositives.count = filtered.length;
          deadExports.possibleFalsePositives.total = filtered.length;
          if (filtered.length === 0) {
            deadExports.possibleFalsePositives.primaryReason = 'unknown';
            deadExports.possibleFalsePositives.reasons = [];
            deadExports.possibleFalsePositives.disclaimer = null;
          }
        }
      }
      const scope = container.depGraph.getScopeSummary();
      const { detectStack } = require('./src/utils/stack-detectors/detect');
      const stack = detectStack(container.workspaceRoot);
      const stats = container.depGraph.getStats();
      // L1-3: analysisCoverage must reflect the filtered file set (same as scope)
      const filteredAnalysisCoverage = stats.filteredAnalysisCoverage || stats.analysisCoverage || null;
      const result = {
        ok: [health, deadExports, unresolved, cycles].every((result) => result.ok !== false),
        workspaceRoot: container.workspaceRoot,
        scope,
        summary: buildRepoSummary(health, deadExports, unresolved, cycles, scope, stack.profile, filteredAnalysisCoverage, stack),
        health,
        deadExports,
        unresolved,
        cycles,
      };
      if (parsed.save) {
        const savePath = path.resolve(parsed.cwd || process.cwd(), parsed.save);
        regressionTools.saveBaseline(result, savePath);
        result.baselineSaved = savePath;
      }
      if (parsed.checkRegression) {
        let baselinePath = null;
        let commitBaseline = null;
        if (parsed.baseline) {
          const resolved = path.resolve(parsed.cwd || process.cwd(), parsed.baseline);
          if (fs.existsSync(resolved)) {
            baselinePath = resolved;
          } else {
            commitBaseline = parsed.baseline;
          }
        }
        if (commitBaseline) {
          result.regression = regressionTools.checkRegressionAgainstCommit(result, commitBaseline, parsed.cwd || process.cwd());
        } else {
          result.regression = regressionTools.checkRegression(result, baselinePath);
        }
      }
      return result;
    }
    case 'audit-file': {
      requireFile(parsed, 'audit-file');
      if (parsed.watch) {
        const { startAuditFileWatch } = require('./src/cli/watch');
        await startAuditFileWatch({
          cwd: parsed.cwd,
          exclude: parsed.exclude,
          targetFile: parsed.file,
          compact: parsed.compact,
        });
        return { ok: true, __managedLifecycle: true };
      }
      const resolvedPath = resolveWorkspaceFilePath(parsed.file, container.workspaceRoot);
      if (!resolvedPath || !fs.existsSync(resolvedPath)) {
        return { ok: false, error: `File not found: ${parsed.file}`, inProject: false };
      }
      const [impact, affectedTests] = await Promise.all([
        dependencyGraph({ cwd: parsed.cwd, operation: 'impact', file: parsed.file }, container),
        dependencyGraph({
          cwd: parsed.cwd,
          operation: 'affected_tests',
          file: parsed.file,
          maxDepth: Number.isFinite(parsed.maxDepth) ? parsed.maxDepth : undefined,
        }, container),
      ]);
      const frameworkPattern = container.depGraph.getFrameworkHint(resolvedPath);
      const validationAdvice = buildFileValidationAdvice(resolvedPath, container.workspaceRoot);
      return {
        ok: impact.ok !== false && affectedTests.ok !== false,
        workspaceRoot: container.workspaceRoot,
        file: parsed.file,
        resolvedPath: impact.resolvedPath || affectedTests.resolvedPath || null,
        summary: buildFileSummary(impact, affectedTests),
        frameworkPattern,
        validationAdvice,
        impact,
        affectedTests,
      };
    }
    case 'audit-diff': {
      const since = parsed.since || null;
      const staged = parsed.staged === true;
      const explicitFiles = parsed.files ? parsed.files.split(',').map((f) => f.trim()).filter(Boolean) : null;

      let changed;
      if (explicitFiles) {
        changed = { ok: true, workspaceRoot: container.workspaceRoot, changedFiles: explicitFiles };
      } else {
        changed = await getChangedFiles(container.workspaceRoot, { staged, includeUntracked: !staged, since });
        if (changed.ok === false) {
          return changed;
        }
      }

      const numstat = explicitFiles
        ? { ok: false }
        : await getDiffNumstat(container.workspaceRoot, { staged, includeUntracked: !staged, since });
      const changeMetrics = numstat.ok ? {
        totalAdditions: numstat.totalAdditions,
        totalDeletions: numstat.totalDeletions,
        changedFileCount: numstat.files.length,
        untrackedFileCount: Math.max(0, changed.changedFiles.length - numstat.files.length),
      } : null;

      const entries = await mapWithConcurrency(changed.changedFiles, DEFAULTS.CLI_CONCURRENCY, async (relativeFile) => {
        const resolvedPath = resolveWorkspaceFilePath(relativeFile, container.workspaceRoot);
        const classification = container.projectContext?.classifyFile(resolvedPath) || null;
        const graphKnown = Boolean(resolvedPath && container.depGraph.hasFile(resolvedPath));
        const impact = graphKnown ? container.depGraph.getImpactRadius(resolvedPath) : [];
        let changedLineRanges = [];
        if (resolvedPath) {
          if (since) {
            const rangeResult = await getChangedLineRanges(container.workspaceRoot, resolvedPath, { since }).catch(() => ({ ok: false }));
            if (rangeResult.ok) changedLineRanges = rangeResult.lineRanges;
          } else if (staged) {
            const stagedResult = await getChangedLineRanges(container.workspaceRoot, resolvedPath, { staged: true }).catch(() => ({ ok: false }));
            if (stagedResult.ok) changedLineRanges = stagedResult.lineRanges;
          } else {
            const [unstagedResult, stagedResult] = await Promise.all([
              getChangedLineRanges(container.workspaceRoot, resolvedPath, { staged: false }).catch(() => ({ ok: false })),
              getChangedLineRanges(container.workspaceRoot, resolvedPath, { staged: true }).catch(() => ({ ok: false })),
            ]);
            const ranges = [];
            if (unstagedResult.ok) ranges.push(...unstagedResult.lineRanges);
            if (stagedResult.ok) ranges.push(...stagedResult.lineRanges);
            const seen = new Set();
            changedLineRanges = ranges.filter((r) => {
              const key = `${r.startLine}-${r.endLine}`;
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            }).sort((a, b) => a.startLine - b.startLine);
          }
        }
        const baseSymbolImpact = graphKnown ? container.depGraph.getSymbolImpact(resolvedPath) : null;
        const changedFunctionImpactBase = graphKnown
          ? container.depGraph.getChangedFunctionImpact(resolvedPath, changedLineRanges, { symbolImpact: baseSymbolImpact })
          : null;
        let reuseHints = [];
        if (parsed.reuseHints === 'on' && graphKnown && changedFunctionImpactBase?.mode === 'function-symbol') {
          try {
            reuseHints = container.depGraph.getFunctionReuseHints(resolvedPath, changedFunctionImpactBase.changedFunctions, {
              minScore: DEFAULTS.REUSE_HINTS_MIN_SCORE,
              maxPerFunction: DEFAULTS.REUSE_HINTS_MAX_PER_FUNCTION,
            });
          } catch (e) {
            // Non-core path: similarity hints should never block main diff analysis.
            if (!parsed.quiet) {
              console.error(`[warn] reuse hints failed for ${relativeFile}: ${e?.message || String(e)}`);
            }
            reuseHints = [];
          }
        }
        const functionLevelAffectedTests = graphKnown &&
          (changedFunctionImpactBase?.mode === 'function-symbol' || changedFunctionImpactBase?.mode === 'internal-function-call-chain')
          ? container.depGraph.getFunctionLevelAffectedTests(
            resolvedPath,
            changedFunctionImpactBase.changedFunctions,
            {
              symbolImpact: baseSymbolImpact,
              maxDepth: Number.isFinite(parsed.maxDepth) ? parsed.maxDepth : DEFAULTS.SYMBOL_IMPACT_DEPTH,
            }
          )
          : { functions: [], affectedTestsCount: 0 };
        const changedFunctionImpact = changedFunctionImpactBase
          ? { ...changedFunctionImpactBase, reuseHints, functionLevelAffectedTests }
          : null;
        const symbolImpact = baseSymbolImpact
          ? { ...baseSymbolImpact, changedFunctionImpact }
          : null;
        const affectedTests = graphKnown ? container.depGraph.findAffectedTests(resolvedPath, Number.isFinite(parsed.maxDepth) ? parsed.maxDepth : undefined) : [];
        const history = resolvedPath ? await getFileHistoryRisk(container.workspaceRoot, resolvedPath, { limit: DEFAULTS.HISTORY_LIMIT }) : { ok: false };
        const historyRisk = history.ok ? history.historyRisk : null;
        const impactExplanations = graphKnown
          ? buildImpactExplanations({ file: relativeFile, impact })
          : [];
        const frameworkPattern = container.depGraph.getFrameworkHint(resolvedPath);
        const baseEntry = {
          file: relativeFile,
          resolvedPath,
          classification,
          graphKnown,
          frameworkPattern,
          impactCount: impact.length,
          impact,
          changedLineRanges,
          symbolImpact,
          affectedTestsCount: affectedTests.length,
          affectedTests,
          historyRisk,
          recentCommits: history.ok ? history.recentCommits : [],
          impactExplanations,
        };
        const compositeRisk = buildCompositeRisk(baseEntry);

        return {
          ...baseEntry,
          compositeRisk,
        };
      });
      const safeEntries = entries.map((entry, index) => {
        if (!entry?.__error) return entry;
        const baseEntry = {
          file: changed.changedFiles[index],
          resolvedPath: null,
          classification: null,
          graphKnown: false,
          frameworkPattern: null,
          impactCount: 0,
          impact: [],
          changedLineRanges: [],
          symbolImpact: null,
          affectedTestsCount: 0,
          affectedTests: [],
          historyRisk: null,
          recentCommits: [],
          processingError: entry.__error,
        };
        return {
          ...baseEntry,
          compositeRisk: buildCompositeRisk(baseEntry),
        };
      });

      const shouldAutoCompact = !parsed.compact && safeEntries.length > DEFAULTS.AUDIT_DIFF_AUTO_COMPACT_THRESHOLD;
      const finalEntries = (parsed.compact || shouldAutoCompact)
        ? safeEntries.map((entry) => compactChangedFile(entry))
        : safeEntries;

      const { detectStack } = require('./src/utils/stack-detectors/detect');
      const stack = detectStack(container.workspaceRoot);
      const result = {
        ok: true,
        workspaceRoot: container.workspaceRoot,
        scope: container.depGraph.getScopeSummary(),
        summary: buildAuditDiffSummary(finalEntries, changeMetrics, stack.profile),
        validationAdvice: buildValidationAdvice(finalEntries, container.workspaceRoot),
        options: {
          reuseHints: parsed.reuseHints,
        },
        changedFiles: finalEntries,
      };
      if (parsed.incremental) {
        const { buildIncrementalFindings } = require('./src/tools/incremental-diff');
        const changedPaths = safeEntries.map((e) => e.resolvedPath).filter(Boolean);
        result.incremental = true;
        result.incrementalFindings = buildIncrementalFindings(changedPaths, container);
      }
      if (parsed.withImpact) {
        const impactFiles = new Set();
        for (const entry of safeEntries) {
          if (!entry.resolvedPath) continue;
          try {
            const impact = container.depGraph.getImpactRadius(entry.resolvedPath, 2);
            for (const i of impact) {
              if (i.file && i.file !== entry.resolvedPath) {
                impactFiles.add(i.file);
              }
            }
          } catch (err) {
            if (process.env.DEBUG) {
              console.error(`[CLI] Impact calculation failed for ${entry.resolvedPath}:`, err.message);
            }
          }
        }
        result.impactFiles = Array.from(impactFiles);
      }
      return result;
    }
    case 'audit-overview':
      return buildProjectOverview(parsed, container);
    case 'audit-map': {
      await container.ensureReady();
      return buildProjectMap(container.depGraph, { compact: parsed.compact });
    }
    case 'health':
      return projectHealth({ cwd: parsed.cwd }, container);
    case 'audit-security': {
      const explicitSecFiles = parsed.files ? parsed.files.split(',').map((f) => f.trim()).filter(Boolean) : null;
      const secResult = await auditSecurity({ cwd: parsed.cwd, targets: explicitSecFiles || parsed.targets, config: parsed.config, language: parsed.language, builtinOnly: parsed.builtinOnly }, container);
      if (parsed.severity && secResult.findings) {
        secResult.findings = secResult.findings.filter((f) => severityMeetsFilter(f.severity, parsed.severity));
        secResult.summary.total = secResult.findings.length;
        secResult.summary.bySeverity = groupBySeverity(secResult.findings);
      }
      return secResult;
    }
    case 'stats':
      return dependencyGraph({ cwd: parsed.cwd, operation: 'stats' }, container);
    case 'dependencies': {
      requireFile(parsed, 'dependencies');
      const depPath = resolveWorkspaceFilePath(parsed.file, container.workspaceRoot);
      if (!depPath || !fs.existsSync(depPath)) {
        return { ok: false, error: `File not found: ${parsed.file}`, inProject: false };
      }
      return dependencyGraph({ cwd: parsed.cwd, operation: 'dependencies', file: parsed.file }, container);
    }
    case 'dependents': {
      requireFile(parsed, 'dependents');
      const dentPath = resolveWorkspaceFilePath(parsed.file, container.workspaceRoot);
      if (!dentPath || !fs.existsSync(dentPath)) {
        return { ok: false, error: `File not found: ${parsed.file}`, inProject: false };
      }
      return dependencyGraph({ cwd: parsed.cwd, operation: 'dependents', file: parsed.file }, container);
    }
    case 'dead-exports':
      return dependencyGraph({ cwd: parsed.cwd, operation: 'dead_exports' }, container);
    case 'unresolved':
      return dependencyGraph({ cwd: parsed.cwd, operation: 'unresolved' }, container);
    case 'cycles':
      return dependencyGraph({ cwd: parsed.cwd, operation: 'cycles' }, container);
    case 'impact': {
      requireFile(parsed, 'impact');
      const impactPath = resolveWorkspaceFilePath(parsed.file, container.workspaceRoot);
      if (!impactPath || !fs.existsSync(impactPath)) {
        return { ok: false, error: `File not found: ${parsed.file}`, inProject: false };
      }
      return dependencyGraph({ cwd: parsed.cwd, operation: 'impact', file: parsed.file, maxDepth: Number.isFinite(parsed.maxDepth) ? parsed.maxDepth : undefined }, container);
    }
    case 'affected-tests': {
      requireFile(parsed, 'affected-tests');
      const atPath = resolveWorkspaceFilePath(parsed.file, container.workspaceRoot);
      if (!atPath || !fs.existsSync(atPath)) {
        return { ok: false, error: `File not found: ${parsed.file}`, inProject: false };
      }
      return dependencyGraph({
        cwd: parsed.cwd,
        operation: 'affected_tests',
        file: parsed.file,
        maxDepth: Number.isFinite(parsed.maxDepth) ? parsed.maxDepth : undefined,
      }, container);
    }
    case 'tree': {
      requireFile(parsed, 'tree');
      const { treeQuery } = require('./src/tools/tree-tools');
      const treePath = resolveWorkspaceFilePath(parsed.file, container.workspaceRoot);
      if (!treePath || !fs.existsSync(treePath)) {
        return { ok: false, error: `File not found: ${parsed.file}`, inProject: false };
      }
      return treeQuery({
        cwd: parsed.cwd,
        file: treePath,
        depth: Number.isFinite(parsed.maxDepth) ? parsed.maxDepth : undefined,
        direction: parsed.direction || 'both',
      }, container);
    }
    case 'repl': {
      const invalidRepl = validateCwd(parsed);
      if (invalidRepl) return { ...invalidRepl, __managedLifecycle: true };
      const { startRepl } = require('./src/cli/repl');
      await startRepl({ cwd: parsed.cwd, exclude: parsed.exclude, quiet: parsed.quiet, eval: parsed.eval, json: parsed.json });
      return { ok: true, __managedLifecycle: true };
    }
    case 'watch': {
      const invalidWatch = validateCwd(parsed);
      if (invalidWatch) return { ...invalidWatch, __managedLifecycle: true };
      const { startWatch } = require('./src/cli/watch');
      await startWatch({ cwd: parsed.cwd, exclude: parsed.exclude, compact: parsed.compact, runTests: parsed.runTests });
      return { ok: true, __managedLifecycle: true };
    }
    case 'init': {
      const invalidInit = validateCwd(parsed);
      if (invalidInit) return { ...invalidInit, __managedLifecycle: true };
      const configPath = path.join(parsed.cwd || process.cwd(), '.workspace-bridge.json');
      if (fs.existsSync(configPath)) {
        const err = { ok: false, error: `.workspace-bridge.json already exists at ${configPath}` };
        if (parsed.json) console.log(JSON.stringify(err, null, 2));
        else console.error(err.error);
        process.exitCode = 1;
        return { ok: false, __managedLifecycle: true };
      }
      const root = parsed.cwd || process.cwd();
      const GENERATED_HINTS = new Set(['node_modules', 'dist', 'build', '.next', '.nuxt', '.svelte-kit', 'out', '.turbo', 'coverage', '.cache', '.git']);
      const REFERENCE_HINTS = new Set(['docs', 'test', 'tests', 'benchmark', 'scripts', 'reference', 'fixtures', 'fixture-temp']);
      const generated = [];
      const reference = [];
      const active = [];
      try {
        for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          if (GENERATED_HINTS.has(entry.name)) generated.push(entry.name);
          else if (REFERENCE_HINTS.has(entry.name)) reference.push(entry.name);
          else if (!entry.name.startsWith('.')) active.push(entry.name);
        }
      } catch { /* ignore read errors */ }
      const defaultConfig = {
        $schema: 'https://workspace-bridge.dev/schema/v1.json',
        directories: {
          active,
          reference,
          archive: [],
          generated,
        },
      };
      fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2) + '\n');

      // Auto-manage .gitignore for workspace-bridge cache artifacts
      const gitignorePath = path.join(root, '.gitignore');
      const GITIGNORE_ENTRIES = [
        '# workspace-bridge cache',
        '.workspace-bridge-cache.json',
        '.workspace-bridge-cache.json.bak',
        '.tmp-*.json',
        '.workspace-bridge-cache.json.tmp-*',
        'cache.db',
        'cache.db-wal',
        'cache.db-shm',
      ];
      let gitignoreUpdated = false;
      try {
        let existing = '';
        if (fs.existsSync(gitignorePath)) {
          existing = fs.readFileSync(gitignorePath, 'utf8');
        }
        const missing = GITIGNORE_ENTRIES.filter((line) => !existing.includes(line));
        if (missing.length > 0) {
          const append = (existing.endsWith('\n') ? '' : '\n') + missing.join('\n') + '\n';
          fs.writeFileSync(gitignorePath, existing + append);
          gitignoreUpdated = true;
        }
      } catch { /* ignore gitignore errors */ }

      const parts = [];
      parts.push('Created .workspace-bridge.json.');
      if (active.length > 0) parts.push(`Active directories: ${active.join(', ')}.`);
      if (generated.length > 0) parts.push(`Generated directories: ${generated.join(', ')}.`);
      if (reference.length > 0) parts.push(`Reference directories: ${reference.join(', ')}.`);
      if (gitignoreUpdated) parts.push('Updated .gitignore with workspace-bridge cache exclusions.');
      parts.push('Adjust "active" / "archive" as needed.');
      const result = {
        ok: true,
        schemaVersion: SCHEMA_VERSION,
        configPath,
        gitignoreUpdated,
        message: parts.join(' '),
      };
      if (parsed.json) console.log(JSON.stringify(result, null, 2));
      else console.log(result.message);
      return { ok: true, __managedLifecycle: true };
    }
    default:
      throw new Error(`Unknown command: ${parsed.command}. Run "workspace-bridge-cli --help" for available commands.`);
  }
}

async function main() {
  let parsed;
  try {
    parsed = parseCliArgs(process.argv);
  } catch (err) {
    console.error(err.message);
    printUsage();
    process.exit(1);
  }

  if (parsed.version) {
    console.log(`workspace-bridge ${version}`);
    return;
  }

  if (parsed.help) {
    if (parsed.command && COMMAND_GUIDES[parsed.command]) {
      printCommandHelp(parsed.command);
    } else {
      printUsage();
    }
    return;
  }
  if (!parsed.command) {
    printUsage();
    return;
  }

  const SELF_MANAGED_COMMANDS = new Set(['repl', 'watch', 'init']);
  const isSelfManaged = SELF_MANAGED_COMMANDS.has(parsed.command) || (parsed.command === 'audit-file' && parsed.watch);
  if (isSelfManaged) {
    await runCommand(parsed, null);
    return;
  }

  // P0: validate --cwd exists and is a directory before entering heavy init
  if (parsed.cwd && (!fs.existsSync(parsed.cwd) || !fs.statSync(parsed.cwd).isDirectory())) {
    const error = `Directory not found: ${parsed.cwd}`;
    if (parsed.json) {
      await writeLargeJson(JSON.stringify({ ok: false, error, schemaVersion: SCHEMA_VERSION }));
    } else {
      console.error(`Error: ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  // Default cacheDir: SQLite in os.tmpdir() with workspaceRoot hash
  // (only when not explicitly overridden via --cache-dir)
  if (!parsed.cacheDir) {
    const { computeDefaultCacheDir } = require('./src/services/cache');
    parsed.cacheDir = computeDefaultCacheDir(path.resolve(parsed.cwd || process.cwd()));
  }

  const container = new ServiceContainer({ quiet: parsed.quiet, cacheDir: parsed.cacheDir });

  try {
    const initialized = await container.initialize(parsed.cwd, TIMEOUTS.INIT_TIMEOUT_MS, {
      watch: false,
      excludeDirs: parsed.exclude,
    });
    if (!initialized) {
      throw container.initError || new Error('Failed to initialize workspace container');
    }

    const result = await runCommand(parsed, container);
    if (result && typeof result === 'object' && result.ok !== false && container) {
      result.staleness = container.getStaleness();
      result.warnings = container.depGraph.buildWarnings();
    }
    if (parsed.format === 'ai') {
      console.log(formatAi(parsed.command, result, {
        depth: parsed.depth || 'detail',
        tokenBudget: parsed.tokenBudget || null,
        schemaVersion: SCHEMA_VERSION,
      }));
    } else if (parsed.format === 'summary') {
      console.log(formatSummary(parsed.command, result));
    } else if (parsed.format === 'jsonl') {
      console.log(formatJsonl(parsed.command, result));
    } else if (parsed.format === 'human') {
      console.log(formatHuman(parsed.command, result));
    } else if (parsed.format === 'markdown' || !parsed.json) {
      // Default human-readable output is markdown for better AI/CI consumption.
      console.log(formatMarkdown(parsed.command, result));
    } else if (parsed.json) {
      if (result && typeof result === 'object') {
        result.schemaVersion = SCHEMA_VERSION;
      }
      const jsonStr = JSON.stringify(result, null, 2);
      if (jsonStr.length > STREAMING.LARGE_JSON_THRESHOLD_BYTES && !parsed.quiet) {
        const edges = result && result.edges ? result.edges.length : 0;
        if (edges > 5000 && !parsed.compact) {
          process.stderr.write(
            '[warn] JSON output is very large (~' +
              Math.round(jsonStr.length / 1024 / 1024) +
              'MB). Consider using --compact for large projects.\n'
          );
        }
      }
      await writeLargeJson(jsonStr);
    }

    process.exitCode = determineExitCode(parsed.command, result, parsed.failOnFindings);
  } catch (err) {
    if (container && container.initError && err === container.initError && err.stack) {
      console.error(err.stack);
    } else {
      console.error(err.message || String(err));
    }
    process.exitCode = 2;
  } finally {
    await container.shutdown();
  }
}

main();

