/**
 * Shared utilities for CLI command handlers.
 */

const fs = require('fs');
const { SCHEMA_VERSION } = require('../../config/constants');

function requireFile(parsed, command) {
  if (!parsed.file) {
    throw new Error(`${command} requires --file <path>`);
  }
}

function validateCwd(parsed) {
  if (parsed.cwd && (!fs.existsSync(parsed.cwd) || !fs.statSync(parsed.cwd).isDirectory())) {
    const error = `Directory not found: ${parsed.cwd}`;
    if (parsed.json) {
      console.log(JSON.stringify({ ok: false, error, schemaVersion: SCHEMA_VERSION }));
    } else {
      console.error(`[path_error] ${error}`);
      console.error(`→ Check if --cwd or --file paths exist and are accessible.`);
    }
    process.exitCode = 1;
    return { ok: false, error };
  }
  return null;
}

module.exports = {
  requireFile,
  validateCwd,
};
