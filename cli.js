#!/usr/bin/env node
/**
 * workspace-bridge CLI
 *
 * Keeps the existing analysis engine behind a local CLI so agents
 * can call it directly.
 *
 * Architecture: thin orchestration layer over extracted modules:
 *   - bootstrap.js      : process config (UV_THREADPOOL_SIZE, fatal handlers)
 *   - validate-args.js  : argument parsing, path sanitization, error classification
 *   - route-formatter.js: formatter routing, streaming JSON, exit-code logic
 */

// Process bootstrap must be first require (sets UV_THREADPOOL_SIZE before any async I/O).
require('./src/cli/bootstrap');

const fs = require('fs');
const path = require('path');
const { version } = require('./package.json');
const { stripBOM } = require('./src/utils/sanitize');

const { ServiceContainer } = require('./src/services/container');
const { toPosixPath, findWorkspaceRoot, normalizePath } = require('./src/utils/path');
const { TIMEOUTS, SCHEMA_VERSION } = require('./src/config/constants');
const { COMMANDS, SELF_MANAGED_COMMANDS } = require('./src/cli/commands');
const { validateCwd } = require('./src/cli/commands/_utils');
const { parseCliArgs, sanitizeCliPaths } = require('./src/cli/validate-args');
const { writeLargeJson, determineExitCode, formatCliResult, buildErrorResponse } = require('./src/cli/route-formatter');
const { installFatalHandlers } = require('./src/cli/bootstrap');
const { workspaceInfo } = require('./src/tools/workspace-tools');

// L2-7: shared CLI options table eliminates duplication between short and long help.
const COMMON_OPTIONS = [
  '  --cwd <path>            Target workspace or file path',
  '  --exclude <paths>       Comma-separated directories, path fragments, or simple globs (*.ext) to exclude',
  '  --eval <command>        Run a single REPL command non-interactively',
  '  --mode <quick|full>     Diagnostics mode (default: quick)',
  '  --file <path>           File path for file-scoped commands',
  '  --max-depth <n>         Max depth for affected-tests (default: 5)',
  '  --reuse-hints <mode>    Reuse hints mode for audit-diff: on|off (default: off)',
  '  --hotspot-data <path>   Write audit-overview hotspot visualization JSON',
  '  --stability-trend-data <path>  Write audit-overview stability trend JSON',
  '  --trend-granularity <mode>  Trend bucket mode for stability trend: day|week (default: day)',
  '  --overview-dashboard <path>  Write audit-overview single-file HTML dashboard',
  '  --json                  Print machine-readable JSON (overridden by --format)',
  '  --format <mode>         Output format: summary | markdown | jsonl | ai | human | json (default: markdown). Takes precedence over --json',
  '  --token-budget <n>      Max estimated tokens for --format ai; auto-downgrades depth if exceeded',
  '  --depth <mode>          Discovery depth for --format ai: surface | detail | full (default: detail)',
  '  --quiet                 Suppress stderr logs during CLI execution',
  '  --compact              Emit condensed tree and directory-level edges',
  '  --no-compact           Explicitly disable compact mode (overrides auto-compact and WB_COMPACT)',
  '  --category <list>      Comma-separated filter for audit-summary (dead-exports,unresolved,cycles,health)',
  '  --fields <list>         Comma-separated list of fields to include in audit-overview / audit-summary',
  '                         Essential fields (ok, error, schemaVersion, command, hasFindings, staleness, warnings) are always kept.',
  '                         For audit-summary, include "health" explicitly if you need the deprecated health compatibility field.',
  '  --sql <query>           SQL select query to run against analysis_snapshots or other tables in query command',
  '  --max-files <n>        Limit returned files in audit-diff, impact, affected-tests, affected-routes, dependencies, dependents, and tree',
  '  --max-dependents <n>   Max allowed direct dependents for guard (default: 50)',
  '  --max-transitive <n>   Max allowed transitive dependents for guard (default: 50)',
  '  --watch                Watch mode for audit-file: re-run on file changes',
  '  --staged               Only analyze git staged changes in audit-diff',
  '  --files <list>         Comma-separated file list for audit-diff / audit-security',
  '  --commits <range>      Git commit range for audit-diff (e.g. HEAD~9..HEAD)',
  '  --incremental          Only show findings related to changed files in audit-diff',
  '  --with-history         Enable per-file git blame/history for audit-overview/summary (slower, disabled by default)',
  '  --save <file>          Save audit-summary findings to a JSON baseline file',
  '  --check-regression     Compare structural metrics (deadExports/unresolved/cycles counts) against previous baseline',
  '  --baseline <file|commit>  Baseline file or commit for --check-regression (default: .workspace-bridge-baseline.json)',
  '  --fail-on-findings     Exit with code 1 if any findings are detected',
  '  --config <name>        Semgrep config (default: auto)',
  '  --language <lang>      Filter security scan to one language',
  '  --service <subpath>     Focus analysis on a single monorepo service/package (others become reference)',
  '  --strict-cwd            Disable Git root elevation (enabled by default; set WB_STRICT_CWD=false or "strictCwd": false in .workspace-bridge.json to opt out)',
  '  --version, -v          Show version',
  '  --help                  Show help',
  '  --help <command>       Show detailed guide for a command',
];

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
  query-hotspots [--risk <high|medium|low>] [--limit <n>]
                            Query cached hotspots (fast slice, no full rebuild)
  query --sql <query>     Execute read-only SQL query against the cache DB
  impact --file <path>    Find impact radius for a file
  affected-tests --file <path> [--max-depth <n>]
                            Find tests related to a file
  affected-routes --file <path> [--max-depth <n>]
                            Find entry-to-file call routes for a file
  dead-exports            Find dead export candidates
  guard [--file <p>|--files <list>|--staged] [--max-dependents <n>] [--max-transitive <n>]
                            Check blast radius and dependents limits before editing
  tree --file <path> [--max-depth <n>] [--direction <imports|dependents|both>]
                            Build import/dependent tree for a file
  cycles                  Find circular dependencies

Options:
${COMMON_OPTIONS.join('\n')}

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
    guard                   Check blast radius and dependents limits before editing
    query-hotspots [--risk <high|medium|low>] [--limit <n>]
                            Query cached hotspots (fast slice, no full rebuild)
    query-knowledge-risk [--level <high|medium|low>] [--limit <n>]
                            Query cached knowledge-risk files
    query-stability [--assessment <fragile|moderate|stable>] [--limit <n>]
                            Query cached stability assessment
    query --sql <query>     Execute read-only SQL query against the cache DB

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
    debug --what graph      Dump dependency graph stats (file/edge counts)

  其他:
    init                    Create default .workspace-bridge.json in cwd
    repl [--eval <cmd>]     Start interactive REPL shell, or run one command non-interactively
    watch                   Watch files and print impact on save

Options:
${COMMON_OPTIONS.join('\n')}
`);
}

async function runCommand(parsed, container) {
  const handler = COMMANDS[parsed.command];
  if (!handler) {
    throw new Error(`Unknown command: ${parsed.command}. Run "workspace-bridge-cli --help" for available commands.`);
  }
  return handler(parsed, container);
}

/**
 * Run CLI command in-process (for testing).
 * Note: self-managed commands (init, watch, audit-file --watch) are handled
 * by main() directly. Do not call this function with those commands.
 */
async function runCliInProcess(args, opts = {}) {
  let parsed;
  try {
    parsed = parseCliArgs(['node', 'cli.js', ...args]);
  } catch (err) {
    const isJsonRequested = args.includes('--json') ||
                            args.includes('--format=json') ||
                            (args.indexOf('--format') >= 0 && args[args.indexOf('--format') + 1] === 'json') ||
                            ['1', 'true', 'yes', 'on'].includes(String(process.env.WB_JSON).toLowerCase()) ||
                            String(process.env.WB_FORMAT).toLowerCase() === 'json';
    if (isJsonRequested) {
      const stdout = JSON.stringify({ ok: false, error: err.message || String(err), schemaVersion: SCHEMA_VERSION });
      return { status: err.code === 'VALIDATION_ERROR' ? 1 : 2, stdout, stderr: '' };
    }
    return { status: err.code === 'VALIDATION_ERROR' ? 1 : 2, stdout: '', stderr: err.message };
  }

  if (parsed.version) {
    return { status: 0, stdout: `workspace-bridge ${version}\n`, stderr: '' };
  }

  // Precedence Origin Report
  if (!parsed.quiet && parsed._sources) {
    const reportParts = [];
    for (const [key, src] of Object.entries(parsed._sources)) {
      if (src !== 'default') {
        reportParts.push(`${key} from ${src}`);
      }
    }
    const configPath = path.join(path.resolve(parsed.cwd), '.workspace-bridge.json');
    if (fs.existsSync(configPath)) {
      let config = {};
      try {
        config = JSON.parse(stripBOM(fs.readFileSync(configPath, 'utf8'))) || {};
      } catch {}
      const configKeys = [];
      if (config.directories) configKeys.push('directories');
      if (config.ignore) configKeys.push('ignore');
      if (config.boundaries) configKeys.push('boundaries');
      if (configKeys.length > 0) {
        reportParts.push(`${configKeys.join('/')} from file`);
      }
    }
    const reportStr = reportParts.length > 0 ? reportParts.join(', ') : 'defaults only';
    console.error(`[Config] Precedence (env > cli > file): ${reportStr}`);
  }

  // Handle Mark False Positive
  if (parsed.markFalsePositive) {
    const cwd = path.resolve(parsed.cwd || process.cwd());
    const configPath = path.join(cwd, '.workspace-bridge.json');
    let config = {};
    if (fs.existsSync(configPath)) {
      try {
        config = JSON.parse(stripBOM(fs.readFileSync(configPath, 'utf8'))) || {};
      } catch (err) {
        return { status: 1, stdout: '', stderr: `Failed to parse config file: ${err.message}` };
      }
    }

    if (!config.ignore) {
      config.ignore = {};
    }
    if (!config.ignore.findings) {
      config.ignore.findings = [];
    }
    if (!config.ignore.findings.includes(parsed.markFalsePositive)) {
      config.ignore.findings.push(parsed.markFalsePositive);
    }

    try {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    } catch (err) {
      return { status: 1, stdout: '', stderr: `Failed to write config file: ${err.message}` };
    }

    const msg = `Finding ${parsed.markFalsePositive} marked as false positive in .workspace-bridge.json`;
    return { status: 0, stdout: msg, stderr: '' };
  }

  if (parsed.help || !parsed.command) {
    let output = '';
    const originalLog = console.log;
    console.log = (...args) => {
      output += args.join(' ') + '\n';
    };
    try {
      if (parsed.command && COMMANDS[parsed.command] && COMMANDS[parsed.command].desc) {
        printCommandHelp(parsed.command);
      } else {
        printUsage(parsed.helpAll);
      }
    } finally {
      console.log = originalLog;
    }
    return { status: 0, stdout: output, stderr: '' };
  }

  // Guard: self-managed commands must be handled by main() to preserve their own exit codes
  const isSelfManaged = SELF_MANAGED_COMMANDS.has(parsed.command) || (parsed.command === 'audit-file' && parsed.watch);
  if (isSelfManaged) {
    return { status: 2, stdout: '', stderr: `In-process runner does not support self-managed command: ${parsed.command}. Use spawn-based runner instead.` };
  }

  const invalidCwd = validateCwd(parsed);
  if (invalidCwd) {
    return { status: 1, stdout: '', stderr: invalidCwd.error };
  }

  const invalidPaths = sanitizeCliPaths(parsed);
  if (invalidPaths) {
    let stdout = '';
    let stderr = '';
    if (parsed.json) {
      stdout = JSON.stringify({ ok: false, error: invalidPaths.error, schemaVersion: SCHEMA_VERSION });
    } else {
      stderr = `[path_error] ${invalidPaths.error}\n→ Check if --cwd or --file paths exist and are accessible.`;
    }
    return { status: 1, stdout, stderr };
  }

  if (!parsed.cacheDir) {
    const { computeDefaultCacheDir } = require('./src/services/cache');
    parsed.cacheDir = computeDefaultCacheDir(path.resolve(parsed.cwd || process.cwd()));
  }

  // Lightweight preflight path: workspace-info should not pay the cost of a full ServiceContainer init.
  if (parsed.command === 'workspace-info') {
    const targetRoot = parsed.strictCwd ? normalizePath(parsed.cwd) : findWorkspaceRoot(parsed.cwd);
    const result = workspaceInfo({ cwd: parsed.cwd, excludeDirs: parsed.exclude }, { workspaceRoot: targetRoot });
    result.hasFindings = false;
    const stdout = formatCliResult(parsed, result, { schemaVersion: SCHEMA_VERSION });
    const status = determineExitCode(parsed.command, result, parsed.failOnFindings);
    return { status, stdout, stderr: '' };
  }

  let container = opts.container;
  const shouldInit = !container;
  if (!container) {
    container = new ServiceContainer({ quiet: parsed.quiet, cacheDir: parsed.cacheDir });
  }

  try {
    if (shouldInit) {
      const initialized = await container.initialize(parsed.cwd, TIMEOUTS.INIT_TIMEOUT_MS, {
        watch: false,
        excludeDirs: parsed.exclude,
        strictCwd: parsed.strictCwd,
        service: parsed.service,
      });
      if (!initialized) {
        throw container.initError || new Error('Failed to initialize workspace container');
      }
    }

    const result = await runCommand(parsed, container);

    if (result && typeof result === 'object' && result.ok !== false && container) {
      result.staleness = container.getStaleness();
      result.warnings = container.snapshot.graph.buildWarnings();
    }

    const stdout = formatCliResult(parsed, result, { schemaVersion: SCHEMA_VERSION });
    const status = determineExitCode(parsed.command, result, parsed.failOnFindings);
    return { status, stdout, stderr: '' };
  } catch (err) {
    return buildErrorResponse(parsed, err, SCHEMA_VERSION);
  } finally {
    if (shouldInit) await container.shutdown();
  }
}

async function main() {
  let parsed;
  try {
    parsed = parseCliArgs(process.argv);
  } catch (err) {
    const args = process.argv;
    const isJsonRequested = args.includes('--json') ||
                            args.includes('--format=json') ||
                            (args.indexOf('--format') >= 0 && args[args.indexOf('--format') + 1] === 'json');
    if (isJsonRequested) {
      console.log(JSON.stringify({ ok: false, error: err.message || String(err), schemaVersion: SCHEMA_VERSION }));
    } else {
      console.error(err.message);
      if (err.code !== 'VALIDATION_ERROR') {
        printUsage();
      }
    }
    process.exit(err.code === 'VALIDATION_ERROR' ? 1 : 2);
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

  if (!parsed.command && !parsed.markFalsePositive) {
    printUsage(false);
    return;
  }

  const isSelfManaged = SELF_MANAGED_COMMANDS.has(parsed.command) || (parsed.command === 'audit-file' && parsed.watch);
  if (isSelfManaged) {
    await runCommand(parsed, null);
    return;
  }

  const result = await runCliInProcess(process.argv.slice(2));
  if (result.stdout) {
    process.stdout.write(result.stdout + (result.stdout.endsWith('\n') ? '' : '\n'));
  }
  if (result.stderr) {
    console.error(result.stderr);
  }
  process.exitCode = result.status;
}

module.exports = { runCliInProcess, COMMON_OPTIONS, printUsage };

if (require.main === module) {
  installFatalHandlers();
  main().catch((err) => {
    console.error('Fatal error:', err.message || String(err));
    if (err.stack) console.error(err.stack);
    process.exit(2);
  });
}
