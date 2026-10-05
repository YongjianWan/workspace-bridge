/**
 * Shared utilities for CLI command handlers.
 */

const fs = require('fs');
const { EXIT_CODES } = require('../../config/constants');
const { buildCliError } = require('../error-envelope');

const CWD_SUGGESTION = 'Check that --cwd points to an existing directory, not a file; a relative --cwd resolves from the current shell directory.';

function requireFile(parsed, command) {
  if (!parsed.file) {
    const err = new Error(`${command} requires --file <path>`);
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
}

/** Pure check: the error to report, or null when --cwd is usable. */
function checkCwd(parsed) {
  if (parsed.cwd && (!fs.existsSync(parsed.cwd) || !fs.statSync(parsed.cwd).isDirectory())) {
    return { ok: false, error: `Directory not found: ${parsed.cwd}`, suggestion: CWD_SUGGESTION };
  }
  return null;
}

/** For self-managed commands that own their stdout/stderr and exit code. */
function validateCwd(parsed) {
  const invalid = checkCwd(parsed);
  if (!invalid) return null;
  const response = buildCliError({
    json: parsed.json, command: parsed.command, type: 'path_error',
    message: invalid.error, suggestion: invalid.suggestion, status: EXIT_CODES.FINDINGS,
  });
  if (parsed.json) console.log(response.stdout);
  else console.error(response.stderr);
  process.exitCode = response.status;
  return invalid;
}

module.exports = {
  requireFile,
  checkCwd,
  validateCwd,
};
