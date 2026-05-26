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
const { toPosixPath, resolveWorkspaceFilePath } = require('./src/utils/path');
const {
  formatHuman,
  formatSummary,
  formatMarkdown,
  formatJsonl,
  formatAi,
} = require('./src/cli/formatters');
const { parseArgs } = require('./src/utils/parse-args');
const { TIMEOUTS, DEFAULTS, STREAMING, SCHEMA_VERSION } = require('./src/config/constants');
const { COMMANDS, SELF_MANAGED_COMMANDS } = require('./src/cli/commands');
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

function printCommandHelp(command) {
  const handler = COMMANDS[command];
  if (!handler || !handler.desc) {
    console.log(`No detailed help for '${command}'. Run without arguments for full command list.`);
    return;
  }
  console.log(`workspace-bridge ${command}

  ${handler.desc}

WHEN TO USE:
  ${handler.when}

AFTER THIS:
  ${handler.after}

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

Curated Commands (Tier 1 — start here):
  audit-summary           Aggregate graph findings (aliased to audit-overview)
  audit-file --file <p> [--watch]  Aggregate impact + affected tests for one file
  audit-diff [--staged] [--files <list>] [--incremental] [--commits <range>]
                            Aggregate changed files + impact + affected tests
  audit-overview          Project panoramic view (hotspots, stability, orphans, dead-exports, unresolved, cycles)
  audit-map               Global project map (tree + edges + issue overlay)
  impact --file <path>    Find impact radius for a file
  affected-tests --file <path> [--max-depth <n>]
                            Find tests related to a file
  dead-exports            Find dead export candidates
  tree --file <path> [--max-depth <n>] [--direction <imports|dependents|both>]
                            Build import/dependent tree for a file
  cycles                  Find circular dependencies

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
  --json                  Print machine-readable JSON (overridden by --format)
  --format <mode>         Output format: summary | markdown | jsonl | ai | human | json (default: markdown). Takes precedence over --json
  --token-budget <n>      Max estimated tokens for --format ai; auto-downgrades depth if exceeded
  --depth <mode>          Discovery depth for --format ai: surface | detail | full (default: detail)
  --quiet                 Suppress stderr logs during CLI execution
  --compact              Emit condensed tree and directory-level edges
  --watch                Watch mode for audit-file: re-run on file changes
  --staged               Only analyze git staged changes in audit-diff
  --files <list>         Comma-separated file list for audit-diff / audit-security
  --commits <range>      Git commit range for audit-diff (e.g. HEAD~9..HEAD)
  --incremental          Only show findings related to changed files in audit-diff
  --save <file>          Save audit-summary findings to a JSON baseline file
  --check-regression     Compare current audit-summary against previous baseline
  --baseline <file|commit>  Baseline file or git commit for --check-regression (default: .workspace-bridge-baseline.json)
  --fail-on-findings     Exit with code 1 if any findings are detected
  --config <name>        Semgrep config (default: auto)
  --language <lang>      Filter security scan to one language
  --help                  Show help
  --help <command>       Show detailed guide for a command

Run --help --all to see the full command list (diagnostic & debug tools included).
`);
    return;
  }

  console.log(`workspace-bridge-cli

Usage:
  workspace-bridge-cli <command> [options]

Commands:
  L1 策展入口 (Curated aggregates — AI default):
    audit-summary           Aggregate graph findings (aliased to audit-overview)
    audit-file --file <p> [--watch]  Aggregate impact + affected tests for one file
    audit-diff [--staged] [--files <list>] [--incremental] [--commits <range>]
                            Aggregate changed files + impact + affected tests
    audit-overview          Project panoramic view (hotspots, stability, orphans, dead-exports, unresolved, cycles)
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
    debug --what symbols    Dump symbol registry stats and duplicates

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
  --json                  Print machine-readable JSON (overridden by --format)
  --format <mode>         Output format: summary | markdown | jsonl | ai | human | json (default: markdown). Takes precedence over --json
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
  --fail-on-findings     Exit with code 1 if any findings are detected
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
    '--commits': { key: 'commits' },
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
    '--what': { key: 'what' },
    '--fail-on-findings': true,
    '--run-tests': true,
    '--version': true,
    '-v': true,
    '--help': true,
    '-h': true,
    '--all': true,
    '--strict-cwd': true,
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
  if (raw.format && !['summary', 'markdown', 'jsonl', 'ai', 'human', 'json'].includes(raw.format)) {
    const err = new Error(`Invalid --format value: ${raw.format}. Expected summary|markdown|jsonl|ai|human|json`);
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
  if (raw.direction && !['imports', 'dependents', 'both'].includes(raw.direction)) {
    const err = new Error(`Invalid --direction value: ${raw.direction}. Expected imports|dependents|both`);
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
  if (raw.mode && !['quick', 'full'].includes(raw.mode)) {
    const err = new Error(`Invalid --mode value: ${raw.mode}. Expected quick|full`);
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
  if (raw.depth && !['surface', 'detail', 'full'].includes(raw.depth)) {
    const err = new Error(`Invalid --depth value: ${raw.depth}. Expected surface|detail|full`);
    err.code = 'VALIDATION_ERROR';
    throw err;
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
    maxDepth: Number.isFinite(raw.maxDepth) ? raw.maxDepth : undefined,
    reuseHints,
    hotspotData: raw.hotspotData || null,
    stabilityTrendData: raw.stabilityTrendData || null,
    trendGranularity,
    overviewDashboard: raw.overviewDashboard || null,
    config: raw.config || null,
    language: raw.language || null,
    builtinOnly: Boolean(raw['--builtin-only']),
    format: raw.format === 'json' ? null : (raw.format || null),
    since: raw.since || null,
    commits: raw.commits || null,
    severity: raw.severity || null,
    staged: Boolean(raw['--staged']),
    files: raw.files || null,
    targets: raw._.slice(1),
    json: Boolean(raw['--json']) || raw.format === 'json',
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
    what: raw.what || null,
    failOnFindings: Boolean(raw['--fail-on-findings']),
    runTests: Boolean(raw['--run-tests']),
    version: Boolean(raw['--version']) || Boolean(raw['-v']),
    help: Boolean(raw['--help']) || Boolean(raw['-h']),
    helpAll: Boolean(raw['--all']),
    depth: raw.depth || null,
    tokenBudget: Number.isFinite(raw.tokenBudget) ? raw.tokenBudget : null,
    strictCwd: Boolean(raw['--strict-cwd']),
  };
}

function sanitizeCliPaths(parsed) {
  const root = path.resolve(parsed.cwd || process.cwd());

  if (parsed.file) {
    const safe = resolveWorkspaceFilePath(parsed.file, root);
    if (!safe) {
      return { ok: false, error: `Invalid --file path: path traversal or escape detected: ${parsed.file}` };
    }
    parsed._rawFile = parsed.file;
    parsed.file = safe;
  }

  if (parsed.files) {
    const parts = parsed.files.split(',').map((f) => f.trim()).filter(Boolean);
    const safeParts = [];
    for (const part of parts) {
      const safe = resolveWorkspaceFilePath(part, root);
      if (!safe) {
        return { ok: false, error: `Invalid --files path: path traversal or escape detected: ${part}` };
      }
      safeParts.push(safe);
    }
    parsed.files = safeParts.join(',');
  }
  return null;
}

function classifyError(err) {
  const msg = (err.message || String(err)).toLowerCase();
  if (msg.includes('enoent') || msg.includes('no such file') || msg.includes('not found')) {
    return { type: 'path_error', suggestion: 'Check if --cwd or --file paths exist and are accessible.' };
  }
  if (msg.includes('eacces') || msg.includes('permission denied')) {
    return { type: 'permission_error', suggestion: 'Check file/directory permissions.' };
  }
  if (msg.includes('timeout') || msg.includes('timed out')) {
    return { type: 'timeout_error', suggestion: 'Try increasing timeout or use --compact for large projects.' };
  }
  if (msg.includes('initialize') || msg.includes('init') || msg.includes('failed to initialize')) {
    return { type: 'init_error', suggestion: 'Try clearing the cache directory (--cache-dir) and retrying.' };
  }
  if (msg.includes('invalid json in config file') || msg.includes('workspace-bridge.json')) {
    return { type: 'config_error', suggestion: 'Please fix the syntax error in your .workspace-bridge.json configuration file.' };
  }
  return { type: 'unexpected_error', suggestion: 'Run "node cli.js --help" for usage.' };
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
    if (err.code === 'VALIDATION_ERROR') {
      process.exit(2);
    }
    printUsage();
    process.exit(1);
  }

  if (parsed.version) {
    console.log(`workspace-bridge ${version}`);
    return;
  }

  if (parsed.help) {
    if (parsed.command && COMMANDS[parsed.command] && COMMANDS[parsed.command].desc) {
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

  // P0: sanitize path arguments to prevent traversal outside the workspace
  const invalidPaths = sanitizeCliPaths(parsed);
  if (invalidPaths) {
    if (parsed.json) {
      console.log(JSON.stringify({ ok: false, error: invalidPaths.error, schemaVersion: SCHEMA_VERSION }));
    } else {
      console.error(`[path_error] ${invalidPaths.error}`);
      console.error(`→ Check if --cwd or --file paths exist and are accessible.`);
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
    const initStart = Date.now();
    const initialized = await container.initialize(parsed.cwd, TIMEOUTS.INIT_TIMEOUT_MS, {
      watch: false,
      excludeDirs: parsed.exclude,
      strictCwd: parsed.strictCwd,
    });
    const initTime = Date.now() - initStart;
    if (!initialized) {
      throw container.initError || new Error('Failed to initialize workspace container');
    }

    const cmdStart = Date.now();
    const result = await runCommand(parsed, container);
    const cmdTime = Date.now() - cmdStart;
    if (!parsed.quiet && container._phaseTimes) {
      const pt = container._phaseTimes;
      process.stderr.write(
        `[timing] init=${initTime}ms (fileIndex=${pt.fileIndex}ms, depGraph=${pt.depGraph}ms) command=${cmdTime}ms\n`
      );
    }
    if (result && typeof result === 'object' && result.ok !== false && container) {
      result.staleness = container.getStaleness();
      result.warnings = container.snapshot.graph.buildWarnings();
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
    const classified = classifyError(err);
    if (parsed.json) {
      console.log(JSON.stringify({ ok: false, error: err.message || String(err), schemaVersion: SCHEMA_VERSION }));
    } else {
      const prefix = `[${classified.type}]`;
      if (container && container.initError && err === container.initError && err.stack) {
        console.error(`${prefix} ${err.message || String(err)}`);
        console.error(`→ ${classified.suggestion}`);
        console.error(err.stack);
      } else {
        console.error(`${prefix} ${err.message || String(err)}`);
        console.error(`→ ${classified.suggestion}`);
      }
    }
    process.exitCode = classified.type === 'config_error' ? 1 : 2;
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

