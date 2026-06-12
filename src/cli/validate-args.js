/**
 * CLI argument parsing, path sanitization, and error classification.
 * Extracted from cli.js to enable unit testing without spawning a process.
 */
const path = require('path');
const fs = require('fs');
const { toPosixPath, resolveWorkspaceFilePath, toRelativePosix } = require('../utils/path');
const { parseArgs } = require('../utils/parse-args');
const { DEFAULTS } = require('../config/constants');

function parseCliArgs(argv) {
  const throwValidationError = (msg) => {
    const err = new Error(msg);
    err.code = 'VALIDATION_ERROR';
    throw err;
  };

  let raw;
  try {
    raw = parseArgs(argv, {
      '--cwd': { key: 'cwd' },
      '--exclude': { key: 'exclude' },
      '--mode': { key: 'mode' },
      '--file': { key: 'file' },
      '--max-depth': { key: 'maxDepth', transform: (v) => {
        const n = Number.parseInt(v, 10);
        if (Number.isNaN(n)) throwValidationError(`Invalid --max-depth value: ${v}. Expected a positive integer`);
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
        if (Number.isNaN(n) || n <= 0) throwValidationError(`Invalid --token-budget value: ${v}. Expected a positive integer`);
        return n;
      } },
      '--depth': { key: 'depth' },
      '--since': { key: 'since' },
      '--commits': { key: 'commits' },
      '--severity': { key: 'severity' },
      '--category': { key: 'category' },
      '--risk': { key: 'risk' },
      '--level': { key: 'level' },
      '--assessment': { key: 'assessment' },
      '--limit': { key: 'limit', transform: (v) => {
        const n = Number.parseInt(v, 10);
        if (Number.isNaN(n) || n <= 0) throwValidationError(`Invalid --limit value: ${v}. Expected a positive integer`);
        return n;
      } },
      '--staged': true,
      '--files': { key: 'files' },
      '--json': true,
      '--quiet': true,
      '--compact': true,
      '--no-compact': true,
      '--max-files': { key: 'maxFiles', transform: (v) => {
        const n = Number.parseInt(v, 10);
        if (Number.isNaN(n) || n <= 0) throwValidationError(`Invalid --max-files value: ${v}. Expected a positive integer`);
        return n;
      } },
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
      '--mark-false-positive': { key: 'markFalsePositive' },
      '--service': { key: 'service' },
    });
  } catch (err) {
    if (!err.code) {
      err.code = 'VALIDATION_ERROR';
    }
    throw err;
  }

  const command = raw._[0] || null;
  const sources = {};

  function resolveOption(cliVal, envName, isBool = false) {
    if (process.env[envName] !== undefined) {
      const val = process.env[envName];
      return {
        value: isBool ? (val === 'true' || val === '1') : val,
        source: 'env'
      };
    }
    if (cliVal !== undefined && cliVal !== null) {
      return { value: cliVal, source: 'cli' };
    }
    return { value: undefined, source: 'default' };
  }

  const cwdRes = resolveOption(raw.cwd, 'WB_CWD');
  sources.cwd = cwdRes.source;
  const cwd = cwdRes.value || process.cwd();

  let exclude = [];
  if (process.env.WB_EXCLUDE !== undefined) {
    exclude = process.env.WB_EXCLUDE.split(',').map((part) => toPosixPath(part.trim())).filter(Boolean);
    sources.exclude = 'env';
  } else if (raw.exclude !== undefined && raw.exclude !== null) {
    exclude = String(raw.exclude).split(',').map((part) => toPosixPath(part.trim())).filter(Boolean);
    sources.exclude = 'cli';
  } else {
    sources.exclude = 'default';
  }

  const modeRes = resolveOption(raw.mode, 'WB_MODE');
  sources.mode = modeRes.source;
  const mode = modeRes.value || 'quick';

  const formatRes = resolveOption(raw.format, 'WB_FORMAT');
  sources.format = formatRes.source;
  const format = formatRes.value || null;

  const jsonRes = resolveOption(raw['--json'], 'WB_JSON', true);
  sources.json = jsonRes.source;
  const json = jsonRes.value || false;

  const quietRes = resolveOption(raw['--quiet'], 'WB_QUIET', true);
  sources.quiet = quietRes.source;
  const quiet = quietRes.value || false;

  const cacheDirRes = resolveOption(raw.cacheDir, 'WB_CACHE_DIR');
  sources.cacheDir = cacheDirRes.source;
  const cacheDir = cacheDirRes.value || null;

  const limitRes = resolveOption(raw.limit, 'WB_LIMIT');
  sources.limit = limitRes.source;
  let limit = null;
  if (limitRes.value !== undefined) {
    limit = Number.parseInt(limitRes.value, 10);
    if (Number.isNaN(limit) || limit <= 0) {
      throwValidationError(`Invalid limit value: ${limitRes.value}. Expected a positive integer`);
    }
  }

  const severityRes = resolveOption(raw.severity, 'WB_SEVERITY');
  sources.severity = severityRes.source;
  const severity = severityRes.value || null;

  const categoryRes = resolveOption(raw.category, 'WB_CATEGORY');
  sources.category = categoryRes.source;
  const category = categoryRes.value || null;

  let compact = false;
  let compactSource = 'default';
  if (raw['--no-compact']) {
    compact = false;
    compactSource = 'cli';
  } else if (raw['--compact']) {
    compact = true;
    compactSource = 'cli';
  } else if (process.env.WB_COMPACT !== undefined) {
    compact = process.env.WB_COMPACT === 'true' || process.env.WB_COMPACT === '1';
    compactSource = 'env';
  }
  sources.compact = compactSource;

  const maxFilesRes = resolveOption(raw.maxFiles, 'WB_MAX_FILES');
  sources.maxFiles = maxFilesRes.source;
  let maxFiles = null;
  if (maxFilesRes.value !== undefined) {
    maxFiles = Number.parseInt(maxFilesRes.value, 10);
    if (Number.isNaN(maxFiles) || maxFiles <= 0) {
      throwValidationError(`Invalid max-files value: ${maxFilesRes.value}. Expected a positive integer`);
    }
  }

  const failOnFindingsRes = resolveOption(raw['--fail-on-findings'], 'WB_FAIL_ON_FINDINGS', true);
  sources.failOnFindings = failOnFindingsRes.source;
  const failOnFindings = failOnFindingsRes.value || false;

  const stagedRes = resolveOption(raw['--staged'], 'WB_STAGED', true);
  sources.staged = stagedRes.source;
  const staged = stagedRes.value || false;

  const runTestsRes = resolveOption(raw['--run-tests'], 'WB_RUN_TESTS', true);
  sources.runTests = runTestsRes.source;
  const runTests = runTestsRes.value || false;

  const withImpactRes = resolveOption(raw['--with-impact'], 'WB_WITH_IMPACT', true);
  sources.withImpact = withImpactRes.source;
  const withImpact = withImpactRes.value || false;

  const incrementalRes = resolveOption(raw['--incremental'], 'WB_INCREMENTAL', true);
  sources.incremental = incrementalRes.source;
  const incremental = incrementalRes.value || false;

  const checkRegressionRes = resolveOption(raw['--check-regression'], 'WB_CHECK_REGRESSION', true);
  sources.checkRegression = checkRegressionRes.source;
  const checkRegression = checkRegressionRes.value || false;

  const serviceRes = resolveOption(raw.service, 'WB_SERVICE');
  sources.service = serviceRes.source;
  const service = serviceRes.value || null;

  const reuseHints = (raw.reuseHints || 'off').toLowerCase();
  if (reuseHints && !['on', 'off'].includes(reuseHints)) {
    throwValidationError(`Invalid --reuse-hints value: ${reuseHints}. Expected on|off`);
  }
  const trendGranularity = (raw.trendGranularity || 'day').toLowerCase();
  if (trendGranularity && !['day', 'week'].includes(trendGranularity)) {
    throwValidationError(`Invalid --trend-granularity value: ${trendGranularity}. Expected day|week`);
  }

  if (Number.isFinite(raw.maxDepth) && raw.maxDepth <= 0) {
    throwValidationError(`Invalid --max-depth value: ${raw.maxDepth}. Expected a positive integer`);
  }
  if (severity && !['high', 'medium', 'low'].includes(severity)) {
    throwValidationError(`Invalid --severity value: ${severity}. Expected high|medium|low`);
  }
  if (category) {
    const validCategories = DEFAULTS.FINDING_CATEGORIES;
    const requested = String(category).split(',').map((c) => c.trim()).filter(Boolean);
    const invalid = requested.filter((c) => !validCategories.has(c));
    if (invalid.length > 0) {
      throwValidationError(`Invalid --category value: ${invalid.join(', ')}. Expected ${Array.from(validCategories).sort().join('|')}`);
    }
  }
  if (format && !['summary', 'markdown', 'jsonl', 'ai', 'human', 'json'].includes(format)) {
    throwValidationError(`Invalid --format value: ${format}. Expected summary|markdown|jsonl|ai|human|json`);
  }
  if (raw.direction && !['imports', 'dependents', 'both'].includes(raw.direction)) {
    throwValidationError(`Invalid --direction value: ${raw.direction}. Expected imports|dependents|both`);
  }
  if (mode && !['quick', 'full'].includes(mode)) {
    throwValidationError(`Invalid --mode value: ${mode}. Expected quick|full`);
  }
  if (raw.depth && !['surface', 'detail', 'full'].includes(raw.depth)) {
    throwValidationError(`Invalid --depth value: ${raw.depth}. Expected surface|detail|full`);
  }

  return {
    command,
    cwd,
    exclude,
    mode,
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
    format: format === 'json' ? null : (format || null),
    since: raw.since || null,
    commits: raw.commits || null,
    severity,
    category,
    staged: Boolean(raw['--staged']),
    files: raw.files || null,
    targets: raw._.slice(1),
    json: json || format === 'json',
    quiet,
    compact,
    noCompact: Boolean(raw['--no-compact']),
    maxFiles,
    watch: Boolean(raw['--watch']),
    incremental,
    withImpact,
    save: raw.save || null,
    checkRegression,
    baseline: raw.baseline || null,
    cacheDir,
    direction: raw.direction || null,
    eval: raw.eval || null,
    what: raw.what || null,
    risk: raw.risk || null,
    level: raw.level || null,
    assessment: raw.assessment || null,
    limit,
    failOnFindings,
    runTests,
    version: Boolean(raw['--version']) || Boolean(raw['-v']),
    help: Boolean(raw['--help']) || Boolean(raw['-h']),
    helpAll: Boolean(raw['--all']),
    depth: raw.depth || null,
    tokenBudget: Number.isFinite(raw.tokenBudget) ? raw.tokenBudget : null,
    strictCwd: Boolean(raw['--strict-cwd']),
    markFalsePositive: raw.markFalsePositive || null,
    service,
    _sources: sources,
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

  if (parsed.service) {
    const safe = resolveWorkspaceFilePath(parsed.service, root);
    if (!safe) {
      return { ok: false, error: `Invalid --service path: path traversal or escape detected: ${parsed.service}` };
    }
    try {
      if (!fs.statSync(safe).isDirectory()) {
        return { ok: false, error: `Invalid --service path: not a directory: ${parsed.service}` };
      }
    } catch (err) {
      return { ok: false, error: `Invalid --service path: does not exist or inaccessible: ${parsed.service}` };
    }
    parsed.service = toRelativePosix(root, safe);
  }

  return null;
}

function classifyError(err) {
  const msg = (err.message || String(err)).toLowerCase();
  if (err.code === 'VALIDATION_ERROR' || msg.includes('requires --') || msg.includes('invalid --')) {
    return { type: 'validation_error', suggestion: 'Please verify the command arguments.' };
  }
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

module.exports = {
  parseCliArgs,
  sanitizeCliPaths,
  classifyError,
};
