/**
 * Shared runtime constants.
 * Keep operational thresholds in one place to reduce magic-number drift.
 */
const TIMEOUTS = {
  COMMAND_DEFAULT_MS: 120000,
  COMMAND_EXISTS_CHECK_MS: 5000,
  GIT_DEFAULT_MS: 30000,
  PYTHON_MODULE_DEFAULT_MS: 30000,
  NPX_DEFAULT_MS: 30000,
  PYTHON_AST_PARSE_MS: 30000,
};

const LIMITS = {
  COMMAND_OUTPUT_MAX_BYTES: 10 * 1024 * 1024,
  EXEC_SYNC_MAX_BUFFER_BYTES: 4 * 1024 * 1024,
  TRIM_OUTPUT_DEFAULT_CHARS: 12000,
  SEARCH_MAX_FILE_BYTES: 1024 * 1024,
};

module.exports = {
  TIMEOUTS,
  LIMITS,
};
