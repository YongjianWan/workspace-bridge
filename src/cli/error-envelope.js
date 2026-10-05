/**
 * The one place a CLI-level failure becomes output.
 *
 * Every error the CLI itself raises (bad arguments, missing --cwd, unsafe paths, a crash in a
 * command) leaves through buildCliError, so JSON consumers always get the same fields:
 * `ok:false`, `error`, `errorType`, `suggestion`, `command`, `schemaVersion`. Tool-level
 * failures are built with `failure()` in utils/failure.js and carry the same
 * `errorType` and `suggestion`.
 */

const { SCHEMA_VERSION } = require('../config/constants');
const { ERROR_TYPES } = require('../utils/failure');

const JSON_ENV_VALUES = ['1', 'true', 'yes', 'on'];

/** True when the raw argv (parsing may have failed) or the environment asks for JSON output. */
function wantsJson(args) {
  const formatAt = args.indexOf('--format');
  return args.includes('--json')
    || args.includes('--format=json')
    || (formatAt >= 0 && args[formatAt + 1] === 'json')
    || JSON_ENV_VALUES.includes(String(process.env.WB_JSON).toLowerCase())
    || String(process.env.WB_FORMAT).toLowerCase() === 'json';
}

/** First non-flag argument, which is the command name whenever parsing got that far. */
function guessCommand(args) {
  return args.find((arg) => !arg.startsWith('-')) || null;
}

/**
 * @param {object} fields
 * @param {boolean} fields.json  render as JSON on stdout instead of text on stderr
 * @param {string} fields.type   one of ERROR_TYPES
 * @param {string} fields.message
 * @param {string} fields.suggestion  the next step for the caller
 * @param {number} fields.status  process exit code
 * @param {string|null} [fields.command]
 * @returns {{status: number, stdout: string, stderr: string}}
 */
function buildCliError({ json, type, message, suggestion, status, command = null }) {
  if (!ERROR_TYPES.includes(type)) throw new Error(`Unknown CLI error type: ${type}`);
  if (json) {
    const envelope = { ok: false, command, error: message, errorType: type, suggestion, schemaVersion: SCHEMA_VERSION };
    return { status, stdout: JSON.stringify(envelope), stderr: '' };
  }
  return { status, stdout: '', stderr: `[${type}] ${message}\n→ ${suggestion}` };
}

module.exports = { ERROR_TYPES, buildCliError, wantsJson, guessCommand };
