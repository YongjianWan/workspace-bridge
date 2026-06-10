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
const { STREAMING, SCHEMA_VERSION } = require('../config/constants');
const { elideDeep } = require('../utils/truncate');

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
  if (!result || result.ok === false) return 1;
  if (result.regression && result.regression.ok === false) return 1;
  return failOnFindings && result.hasFindings === true ? 1 : 0;
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
  let stdout = '';
  if (parsed.format === 'ai') {
    stdout = formatAi(parsed.command, result, {
      depth: parsed.depth || 'detail',
      tokenBudget: parsed.tokenBudget || null,
      schemaVersion,
    });
  } else if (parsed.format === 'summary') {
    stdout = formatSummary(parsed.command, result);
  } else if (parsed.format === 'jsonl') {
    stdout = formatJsonl(parsed.command, result);
  } else if (parsed.format === 'human') {
    stdout = formatHuman(parsed.command, result);
  } else if (parsed.format === 'markdown' || !parsed.json) {
    stdout = formatMarkdown(parsed.command, result);
  } else if (parsed.json) {
    let output = result && typeof result === 'object' ? elideDeep(result) : result;
    if (output && typeof output === 'object') {
      output.schemaVersion = schemaVersion;
    }
    stdout = JSON.stringify(output, null, 2);
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
