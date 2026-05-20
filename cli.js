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

const { ServiceContainer } = require('./src/services/container');
const { toPosixPath } = require('./src/utils/path');
const {
  formatHuman,
  formatSummary,
  formatMarkdown,
  formatJsonl,
  formatAi,
} = require('./src/cli/formatters');
const { parseArgs } = require('./src/utils/parse-args');
const { TIMEOUTS, DEFAULTS, STREAMING, SCHEMA_VERSION } = require('./src/config/constants');
const { COMMANDS } = require('./src/cli/commands');
const { validateCwd } = require('./src/cli/commands/_utils');

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

function printUsage(showAll = false) {
  if (!showAll) {
    console.log(`workspace-bridge-cli

Usage:
  workspace-bridge-cli <command> [options]

Core Commands:
  audit-summary           Aggregate health + graph findings
  audit-file --file <p> [--watch]  Aggregate impact + affected tests for one file
  audit-diff [--staged] [--files <list>] [--incremental]
                            Aggregate changed files + impact + affected tests
  audit-overview          Project panoramic view (hotspots, stability, orphans)
  audit-map               Global project map (tree + edges + issue overlay)

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

Run --help --all to see the full command list (L2-L4 debug tools included).
`);
    return;
  }

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
    '--all': true,
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
        .map((part) => toPosixPath(part.trim()))
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
    helpAll: Boolean(raw['--all']),
    depth: raw.depth || null,
    tokenBudget: Number.isFinite(raw.tokenBudget) ? raw.tokenBudget : null,
  };
}

function determineExitCode(command, result, failOnFindings = false) {
  if (!result || result.ok === false) return 1;
  if (result.regression && result.regression.ok === false) return 1;
  return failOnFindings && result.hasFindings === true ? 1 : 0;
}

async function runCommand(parsed, container) {
  const handler = COMMANDS[parsed.command];
  if (!handler) {
    throw new Error(`Unknown command: ${parsed.command}. Run "workspace-bridge-cli --help" for available commands.`);
  }
  return handler(parsed, container);
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
      printUsage(parsed.helpAll);
    }
    return;
  }
  if (!parsed.command) {
    printUsage(false);
    return;
  }

  const SELF_MANAGED_COMMANDS = new Set(['repl', 'watch', 'init']);
  const isSelfManaged = SELF_MANAGED_COMMANDS.has(parsed.command) || (parsed.command === 'audit-file' && parsed.watch);
  if (isSelfManaged) {
    await runCommand(parsed, null);
    return;
  }

  // P0: validate --cwd exists and is a directory before entering heavy init
  const invalidCwd = validateCwd(parsed);
  if (invalidCwd) {
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
        if (edges > DEFAULTS.LARGE_PROJECT_EDGE_WARNING_THRESHOLD && !parsed.compact) {
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

function installFatalHandlers() {
  process.on('unhandledRejection', (reason) => {
    console.error('Fatal: Unhandled promise rejection');
    if (reason instanceof Error) {
      console.error(reason.message || String(reason));
      if (reason.stack) console.error(reason.stack);
    } else {
      console.error(String(reason));
    }
    process.exit(2);
  });

  process.on('uncaughtException', (err) => {
    console.error('Fatal: Uncaught exception');
    console.error(err.message || String(err));
    if (err.stack) console.error(err.stack);
    process.exit(2);
  });
}

installFatalHandlers();

main().catch((err) => {
  console.error('Fatal error:', err.message || String(err));
  if (err.stack) console.error(err.stack);
  process.exit(2);
});

