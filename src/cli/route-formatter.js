/**
 * CLI output formatting router and streaming utilities.
 * Extracted from cli.js to enable unit testing of formatter selection
 * and large-JSON streaming without spawning a process.
 */
const {
  formatHuman,
  formatSummary,
  formatMarkdown,
  formatJsonl,
  formatAi,
} = require('./formatters');
const { STREAMING, SCHEMA_VERSION, EXIT_CODES, DEFAULTS } = require('../config/constants');
const { elideDeep } = require('../utils/truncate');
const { warningOf } = require('../services/ledger');
const { buildCliError } = require('./error-envelope');

const COMMAND_ARRAY_LIMITS = { 'affected-tests': DEFAULTS.AFFECTED_TESTS_COMMAND_MAX_ITEMS };

const ESSENTIAL_FIELDS =['ok', 'error', 'schemaVersion', 'command', 'hasFindings', 'staleness', 'warnings', 'dataQuality'];

/**
 * Prune result keys to the requested field list. Essential envelope keys are
 * always preserved.
 */
function applyFieldsFilter(result, fields) {
  if (!fields || !result || typeof result !== 'object' || result.ok === false) return;
  const allowed = new Set(fields.split(',').map((f) => f.trim()).filter(Boolean));
  const unknown = [...allowed].filter(field => !Object.prototype.hasOwnProperty.call(result, field) && !ESSENTIAL_FIELDS.includes(field));
  if (unknown.length) {
    if (!Array.isArray(result.warnings)) result.warnings = [];
    result.warnings.push(warningOf('unknown-fields', { message: `Unknown output field(s): ${unknown.join(', ')}` }));
  }
  for (const key of Object.keys(result)) {
    if (!ESSENTIAL_FIELDS.includes(key) && !allowed.has(key)) {
      delete result[key];
    }
  }
}

function appendWarning(result, message) {
  if (!result || typeof result !== 'object' || result.ok === false) return;
  if (!Array.isArray(result.warnings)) result.warnings = [];
  if (!result.warnings.some((warning) => warning.message === message)) result.warnings.push(warningOf('ignored-option', { message }));
}

function maybeWarnIgnoredOptions(parsed, result) {
  if (!result || typeof result !== 'object' || result.ok === false) return;
  if (parsed.format !== 'ai') {
    if (parsed.tokenBudget) appendWarning(result, '--token-budget only applies to --format ai; ignored here');
  }
  // --depth is now consumed by human/summary/markdown/ai as a truncation/detail level.
  // Only json/jsonl ignore it. When no --format is given the default is markdown.
  const isTextFormat = !parsed.format || ['human', 'summary', 'markdown'].includes(parsed.format);
  if (parsed.depth && parsed.format !== 'ai' && !isTextFormat) {
    appendWarning(result, '--depth only applies to --format ai/human/summary/markdown; ignored here');
  }
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

function determineExitCode(command, result, failOnFindings = false) {
  const { OK, FINDINGS } = EXIT_CODES;
  if (!result || result.ok === false) return FINDINGS;
  if (result.regression && result.regression.ok === false) return FINDINGS;
  if (command === 'guard') {
    return result.passed === false ? FINDINGS : OK;
  }
  return failOnFindings && result.hasFindings === true ? FINDINGS : OK;
}

/**
 * Format a CLI result based on parsed arguments.
 * @param {object} parsed
 * @param {object} result
 * @param {object} [meta]
 * @param {string} [meta.schemaVersion]
 * @returns {string}
 */
function formatCliResult(parsed, result, meta = {}) {
  const schemaVersion = meta.schemaVersion || SCHEMA_VERSION;

  const isStructuredOutput =
    parsed.json ||
    parsed.format === 'ai' ||
    parsed.format === 'jsonl' ||
    parsed.format === 'json';

  if (result && typeof result === 'object' && result.ok !== false) {
    if (isStructuredOutput) {
      applyFieldsFilter(result, parsed.fields);
    }
    if (parsed.format === 'ai' && parsed.fields) {
      appendWarning(result, '--fields reduced AI digest input; counts and topRisks may be incomplete');
    }
    maybeWarnIgnoredOptions(parsed, result);
  }

  let stdout;
  const textOptions = { maxFiles: parsed.maxFiles, limit: parsed.limit, depth: parsed.depth };
  if (parsed.format === 'ai') {
    stdout = formatAi(parsed.command, result, {
      depth: parsed.depth || 'detail',
      tokenBudget: parsed.tokenBudget || null,
      schemaVersion,
    });
  } else if (parsed.format === 'summary') {
    stdout = formatSummary(parsed.command, result, textOptions);
  } else if (parsed.format === 'jsonl') {
    stdout = formatJsonl(parsed.command, result);
  } else if (parsed.format === 'human') {
    stdout = formatHuman(parsed.command, result, textOptions);
  } else if (parsed.format === 'json' || parsed.json) {
    // --format json and --json are equivalent for structured output.
    const elided = [...(result?.elided || [])];
    // An explicit --max-files is the caller's own budget; the size net must not undercut it.
    // A command whose own tool already declares a larger list limit (affected-tests: the list is the
    // answer) keeps it; otherwise the generic net would silently cut a list the tool chose to return.
    const maxArrayLength = Math.max(
      DEFAULTS.JSON_OUTPUT_MAX_ARRAY_ITEMS,
      COMMAND_ARRAY_LIMITS[parsed.command] || 0,
      Number.isFinite(parsed.maxFiles) ? parsed.maxFiles : 0
    );
    let output = result && typeof result === 'object' ? elideDeep(result, { elided, maxArrayLength }) : result;
    if (output && typeof output === 'object') {
      // Every cut — the producer's compact mode or the size net above — is
      // listed once at the top so a consumer never mistakes a slice for the whole.
      if (elided.length > 0) {
        output.elided = elided.filter((e) => e.path !== 'elided' && !e.path.startsWith('elided['));
        output.truncated = true;
      }
      output.schemaVersion = schemaVersion;
      if (parsed.command) {
        output.command = parsed.command;
      }
    }
    stdout = JSON.stringify(output, null, 2);
  } else {
    // Default and explicit --format markdown
    stdout = formatMarkdown(parsed.command, result, textOptions);
  }
  return stdout;
}

/**
 * Build a CLI error response object.
 * @param {object} parsed
 * @param {Error} err
 * @returns {{status: number, stdout: string, stderr: string}}
 */
function buildErrorResponse(parsed, err) {
  const { classifyError } = require('./validate-args');
  const classified = classifyError(err);
  const status = (classified.type === 'config_error' || classified.type === 'validation_error')
    ? EXIT_CODES.FINDINGS
    : EXIT_CODES.CLI_ERROR;
  return buildCliError({
    json: parsed.json, command: parsed.command, type: classified.type,
    message: err.message || String(err), suggestion: classified.suggestion, status,
  });
}

module.exports = {
  writeLargeJson,
  determineExitCode,
  formatCliResult,
  buildErrorResponse,
};
