/**
 * CLI argument parsing, path sanitization, and error classification.
 * Extracted from cli.js to enable unit testing without spawning a process.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { toPosixPath, resolveWorkspaceFilePath, toRelativePosix } = require('../utils/path');
const { parseArgs } = require('../utils/parse-args');
const { DEFAULTS } = require('../config/constants');
const { validateCategories } = require('../tools/category-filter');

function parseTomlContent(content) {
  const config = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('[')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let val = trimmed.slice(idx + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) {
      val = val.slice(1, -1);
    } else if (val.startsWith("'") && val.endsWith("'")) {
      val = val.slice(1, -1);
    } else if (val === 'true') {
      val = true;
    } else if (val === 'false') {
      val = false;
    } else if (!Number.isNaN(Number(val))) {
      val = Number(val);
    }
    config[key] = val;
  }
  return config;
}

function parseEnvContent(content) {
  const env = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
    env[key] = val;
  }
  return env;
}

function mapEnvKeyToOptionKey(key) {
  const mapping = {
    'WB_CWD': 'cwd',
    'WB_EXCLUDE': 'exclude',
    'WB_MODE': 'mode',
    'WB_FORMAT': 'format',
    'WB_JSON': 'json',
    'WB_QUIET': 'quiet',
    'WB_CACHE_DIR': 'cacheDir',
    'WB_LIMIT': 'limit',
    'WB_SEVERITY': 'severity',
    'WB_CATEGORY': 'category',
    'WB_COMPACT': 'compact',
    'WB_MAX_FILES': 'maxFiles',
    'WB_FAIL_ON_FINDINGS': 'failOnFindings',
    'WB_STAGED': 'staged',
    'WB_RUN_TESTS': 'runTests',
    'WB_WITH_IMPACT': 'withImpact',
    'WB_WITH_HISTORY': 'withHistory',
    'WB_INCREMENTAL': 'incremental',
    'WB_CHECK_REGRESSION': 'checkRegression',
    'WB_SERVICE': 'service',
    'WB_BUILTIN_ONLY': 'builtinOnly',
    'WB_WATCH': 'watch',
    'WB_STRICT_CWD': 'strictCwd',
  };
  if (mapping[key]) return mapping[key];
  const camel = key.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
  return camel;
}

function loadUserConfig() {
  const homeDir = os.homedir();
  const userConfigDir = path.join(homeDir, '.workspace-bridge');
  const config = {};
  const sources = {};

  if (!fs.existsSync(userConfigDir)) {
    return { config, sources };
  }

  const tomlPath = path.join(userConfigDir, 'config.toml');
  if (fs.existsSync(tomlPath)) {
    try {
      const content = fs.readFileSync(tomlPath, 'utf8');
      const parsed = parseTomlContent(content);
      for (const [k, v] of Object.entries(parsed)) {
        config[k] = v;
        sources[k] = 'user-config';
      }
    } catch {}
  }

  const envPath = path.join(userConfigDir, '.env');
  if (fs.existsSync(envPath)) {
    try {
      const content = fs.readFileSync(envPath, 'utf8');
      const parsed = parseEnvContent(content);
      for (const [k, v] of Object.entries(parsed)) {
        const optionKey = mapEnvKeyToOptionKey(k);
        if (optionKey) {
          config[optionKey] = v;
          sources[optionKey] = 'user-config';
        }
      }
    } catch {}
  }

  return { config, sources };
}

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
      '--with-history': true,
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

  // First determine cwd so we can look up project config
  const rawCwdRes = raw.cwd !== undefined ? raw.cwd : (process.env.WB_CWD || null);
  if (raw.cwd !== undefined) {
    sources.cwd = 'cli';
  } else if (process.env.WB_CWD !== undefined) {
    sources.cwd = 'env';
  } else {
    sources.cwd = 'default';
  }
  const cwd = path.resolve(rawCwdRes || process.cwd());

  let projectConfig = {};
  try {
    const configPath = path.join(cwd, '.workspace-bridge.json');
    if (fs.existsSync(configPath)) {
      const { stripBOM } = require('../utils/sanitize');
      projectConfig = JSON.parse(stripBOM(fs.readFileSync(configPath, 'utf8'))) || {};
    }
  } catch {}

  const { config: userConfig } = loadUserConfig();

  function isTruthyEnv(val) {
    if (val === undefined || val === null) return false;
    const v = String(val).toLowerCase();
    return v === 'true' || v === 'yes' || v === 'on' || v === '1';
  }

  function resolveOption(cliVal, envName, projectVal, userVal, isBool = false) {
    if (cliVal !== undefined && cliVal !== null) {
      return { value: cliVal, source: 'cli' };
    }
    if (process.env[envName] !== undefined) {
      const val = process.env[envName];
      return {
        value: isBool ? isTruthyEnv(val) : val,
        source: 'env'
      };
    }
    if (projectVal !== undefined && projectVal !== null) {
      return { value: projectVal, source: 'project-config' };
    }
    if (userVal !== undefined && userVal !== null) {
      return { value: userVal, source: 'user-config' };
    }
    return { value: undefined, source: 'default' };
  }

  // exclude needs special splitting logic
  const rawExcludeRes = resolveOption(
    raw.exclude,
    'WB_EXCLUDE',
    projectConfig.exclude,
    userConfig.exclude
  );
  sources.exclude = rawExcludeRes.source;
  let exclude = [];
  if (rawExcludeRes.value) {
    exclude = String(rawExcludeRes.value).split(',').map((part) => toPosixPath(part.trim())).filter(Boolean);
  }

  const modeRes = resolveOption(raw.mode, 'WB_MODE', projectConfig.mode, userConfig.mode);
  sources.mode = modeRes.source;
  const mode = String(modeRes.value || 'quick').toLowerCase();

  const formatRes = resolveOption(raw.format, 'WB_FORMAT', projectConfig.format, userConfig.format);
  sources.format = formatRes.source;
  const format = formatRes.value ? String(formatRes.value).toLowerCase() : null;

  const jsonRes = resolveOption(raw['--json'], 'WB_JSON', projectConfig.json, userConfig.json, true);
  sources.json = jsonRes.source;
  const json = jsonRes.value || false;

  const quietRes = resolveOption(raw['--quiet'], 'WB_QUIET', projectConfig.quiet, userConfig.quiet, true);
  sources.quiet = quietRes.source;
  const quiet = quietRes.value || false;

  const cacheDirRes = resolveOption(raw.cacheDir, 'WB_CACHE_DIR', projectConfig.cacheDir, userConfig.cacheDir);
  sources.cacheDir = cacheDirRes.source;
  const cacheDir = cacheDirRes.value || null;

  const limitRes = resolveOption(raw.limit, 'WB_LIMIT', projectConfig.limit, userConfig.limit);
  sources.limit = limitRes.source;
  let limit = null;
  if (limitRes.value !== undefined) {
    limit = Number.parseInt(limitRes.value, 10);
    if (Number.isNaN(limit) || limit <= 0) {
      throwValidationError(`Invalid limit value: ${limitRes.value}. Expected a positive integer`);
    }
  }

  const severityRes = resolveOption(raw.severity, 'WB_SEVERITY', projectConfig.severity, userConfig.severity);
  sources.severity = severityRes.source;
  const severity = severityRes.value ? String(severityRes.value).toLowerCase() : null;

  const categoryRes = resolveOption(raw.category, 'WB_CATEGORY', projectConfig.category, userConfig.category);
  sources.category = categoryRes.source;
  const category = categoryRes.value ? String(categoryRes.value).toLowerCase() : null;

  let compactCliVal = undefined;
  if (raw['--no-compact']) {
    compactCliVal = false;
  } else if (raw['--compact']) {
    compactCliVal = true;
  }
  const compactRes = resolveOption(
    compactCliVal,
    'WB_COMPACT',
    projectConfig.compact,
    userConfig.compact,
    true
  );
  sources.compact = compactRes.source;
  const compact = compactRes.value || false;

  const maxFilesRes = resolveOption(raw.maxFiles, 'WB_MAX_FILES', projectConfig.maxFiles, userConfig.maxFiles);
  sources.maxFiles = maxFilesRes.source;
  let maxFiles = null;
  if (maxFilesRes.value !== undefined) {
    maxFiles = Number.parseInt(maxFilesRes.value, 10);
    if (Number.isNaN(maxFiles) || maxFiles <= 0) {
      throwValidationError(`Invalid max-files value: ${maxFilesRes.value}. Expected a positive integer`);
    }
  }

  const failOnFindingsRes = resolveOption(raw['--fail-on-findings'], 'WB_FAIL_ON_FINDINGS', projectConfig.failOnFindings, userConfig.failOnFindings, true);
  sources.failOnFindings = failOnFindingsRes.source;
  const failOnFindings = failOnFindingsRes.value || false;

  const stagedRes = resolveOption(raw['--staged'], 'WB_STAGED', projectConfig.staged, userConfig.staged, true);
  sources.staged = stagedRes.source;
  const staged = stagedRes.value || false;

  const runTestsRes = resolveOption(raw['--run-tests'], 'WB_RUN_TESTS', projectConfig.runTests, userConfig.runTests, true);
  sources.runTests = runTestsRes.source;
  const runTests = runTestsRes.value || false;

  const withImpactRes = resolveOption(raw['--with-impact'], 'WB_WITH_IMPACT', projectConfig.withImpact, userConfig.withImpact, true);
  sources.withImpact = withImpactRes.source;
  const withImpact = withImpactRes.value || false;

  const withHistoryRes = resolveOption(raw['--with-history'], 'WB_WITH_HISTORY', projectConfig.withHistory, userConfig.withHistory, true);
  sources.withHistory = withHistoryRes.source;
  const withHistory = withHistoryRes.value || false;

  const incrementalRes = resolveOption(raw['--incremental'], 'WB_INCREMENTAL', projectConfig.incremental, userConfig.incremental, true);
  sources.incremental = incrementalRes.source;
  const incremental = incrementalRes.value || false;

  const checkRegressionRes = resolveOption(raw['--check-regression'], 'WB_CHECK_REGRESSION', projectConfig.checkRegression, userConfig.checkRegression, true);
  sources.checkRegression = checkRegressionRes.source;
  const checkRegression = checkRegressionRes.value || false;

  const serviceRes = resolveOption(raw.service, 'WB_SERVICE', projectConfig.service, userConfig.service);
  sources.service = serviceRes.source;
  const service = serviceRes.value || null;

  const builtinOnlyRes = resolveOption(raw['--builtin-only'], 'WB_BUILTIN_ONLY', projectConfig.builtinOnly, userConfig.builtinOnly, true);
  sources.builtinOnly = builtinOnlyRes.source;
  const builtinOnly = builtinOnlyRes.value || false;

  const watchRes = resolveOption(raw['--watch'], 'WB_WATCH', projectConfig.watch, userConfig.watch, true);
  sources.watch = watchRes.source;
  const watch = watchRes.value || false;

  const strictCwdRes = resolveOption(raw['--strict-cwd'], 'WB_STRICT_CWD', projectConfig.strictCwd, userConfig.strictCwd, true);
  sources.strictCwd = strictCwdRes.source;
  const strictCwd = strictCwdRes.value || false;

  const reuseHints = (raw.reuseHints || 'off').toLowerCase();
  if (reuseHints && !['on', 'off'].includes(reuseHints)) {
    throwValidationError(`Invalid --reuse-hints value: ${reuseHints}. Expected on|off`);
  }
  const trendGranularity = (raw.trendGranularity || 'day').toLowerCase();
  if (trendGranularity && !['day', 'week'].includes(trendGranularity)) {
    throwValidationError(`Invalid --trend-granularity value: ${trendGranularity}. Expected day|week`);
  }

  const direction = raw.direction ? String(raw.direction).toLowerCase() : null;
  const depth = raw.depth ? String(raw.depth).toLowerCase() : null;

  if (Number.isFinite(raw.maxDepth) && raw.maxDepth <= 0) {
    throwValidationError(`Invalid --max-depth value: ${raw.maxDepth}. Expected a positive integer`);
  }
  if (severity && !['high', 'medium', 'low'].includes(severity)) {
    throwValidationError(`Invalid --severity value: ${severity}. Expected high|medium|low`);
  }
  if (category) {
    const validation = validateCategories(category);
    if (!validation.valid) {
      throwValidationError(`Invalid --category value: ${validation.invalid.join(', ')}. Expected ${Array.from(DEFAULTS.FINDING_CATEGORIES).sort().join('|')}`);
    }
  }
  if (format && !['summary', 'markdown', 'jsonl', 'ai', 'human', 'json'].includes(format)) {
    throwValidationError(`Invalid --format value: ${format}. Expected summary|markdown|jsonl|ai|human|json`);
  }
  if (direction && !['imports', 'dependents', 'both'].includes(direction)) {
    throwValidationError(`Invalid --direction value: ${direction}. Expected imports|dependents|both`);
  }
  if (mode && !['quick', 'full'].includes(mode)) {
    throwValidationError(`Invalid --mode value: ${mode}. Expected quick|full`);
  }
  if (depth && !['surface', 'detail', 'full'].includes(depth)) {
    throwValidationError(`Invalid --depth value: ${depth}. Expected surface|detail|full`);
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
    builtinOnly,
    format: format === 'json' ? null : (format || null),
    since: raw.since || null,
    commits: raw.commits || null,
    severity,
    category,
    staged,
    files: raw.files || null,
    targets: raw._.slice(1),
    json: json || format === 'json',
    quiet,
    compact,
    noCompact: Boolean(raw['--no-compact']),
    maxFiles,
    watch,
    incremental,
    withImpact,
    withHistory,
    save: raw.save || null,
    checkRegression,
    baseline: raw.baseline || null,
    cacheDir,
    direction,
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
    depth,
    tokenBudget: Number.isFinite(raw.tokenBudget) ? raw.tokenBudget : null,
    strictCwd,
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
