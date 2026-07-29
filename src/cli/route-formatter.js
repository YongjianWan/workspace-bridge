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
const { STREAMING, SCHEMA_VERSION, EXIT_CODES } = require('../config/constants');
const { elideDeep } = require('../utils/truncate');

const ESSENTIAL_FIELDS = ['ok', 'error', 'schemaVersion', 'command', 'hasFindings', 'staleness', 'warnings'];

/**
 * Prune result keys to the requested field list. Essential envelope keys are
 * always preserved.
 */
function applyFieldsFilter(result, fields) {
  if (!fields || !result || typeof result !== 'object' || result.ok === false) return;
  const allowed = new Set(fields.split(',').map((f) => f.trim()).filter(Boolean));
  for (const key of Object.keys(result)) {
    if (!ESSENTIAL_FIELDS.includes(key) && !allowed.has(key)) {
      delete result[key];
    }
  }
}

function appendWarning(result, message) {
  if (!result || typeof result !== 'object' || result.ok === false) return;
  if (!Array.isArray(result.warnings)) result.warnings = [];
  if (!result.warnings.includes(message)) result.warnings.push(message);
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
    let output = result && typeof result === 'object' ? elideDeep(result) : result;
    if (output && typeof output === 'object') {
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
 * @param {string} [schemaVersion]
 * @returns {{status: number, stdout: string, stderr: string}}
 */
function buildErrorResponse(parsed, err, schemaVersion = SCHEMA_VERSION) {
  const { classifyError } = require('./validate-args');
  const classified = classifyError(err);
  let stdout = '';
  let stderr = '';
  if (parsed.json) {
    stdout = JSON.stringify({ ok: false, error: err.message || String(err), schemaVersion });
  } else {
    stderr = `[${classified.type}] ${err.message || String(err)}\n→ ${classified.suggestion}`;
  }
  const status = (classified.type === 'config_error' || classified.type === 'validation_error') ? 1 : 2;
  return { status, stdout, stderr };
}

module.exports = {
  writeLargeJson,
  determineExitCode,
  formatCliResult,
  buildErrorResponse,
};
