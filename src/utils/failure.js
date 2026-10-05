/**
 * A failed tool result, in one shape: `{ ok:false, errorType, error, suggestion, ...extra }`.
 *
 * `errorType` comes from the site that knows what went wrong, so no consumer has to guess it
 * from the message text. `suggestion` is the next step for the caller; a site passes its own
 * when it knows more than the type does (see revisionSuggestion in git-tools).
 */

const SUGGESTIONS = Object.freeze({
  validation_error: 'Check the command arguments; run "node cli.js <command> --help" for usage.',
  path_error: 'Check that the path exists and is inside the workspace; --file is resolved relative to --cwd.',
  git_error: 'Run inside a git repository and pass a revision or range that exists (for example HEAD~9..HEAD).',
  init_error: 'The workspace index is not ready; retry, or clear the cache directory (--cache-dir) and run again.',
  query_error: 'Use a single read-only SELECT statement against the cache tables.',
  config_error: 'Fix .workspace-bridge.json, or delete it and run "node cli.js init" to regenerate it.',
  permission_error: 'Check file and directory permissions.',
  timeout_error: 'Retry with a longer timeout, or use --compact for large projects.',
  unknown_command: 'Run "node cli.js --help" for the list of commands.',
  unexpected_error: 'Run "node cli.js --help" for usage; if it persists, report the command and the error.',
});

const ERROR_TYPES = Object.freeze(Object.keys(SUGGESTIONS));

/**
 * @param {string} type  one of ERROR_TYPES
 * @param {string} message
 * @param {object} [extra]  further result fields; `extra.suggestion` replaces the default
 */
function failure(type, message, extra = {}) {
  if (!SUGGESTIONS[type]) throw new Error(`Unknown error type: ${type}`);
  return { ok: false, errorType: type, error: message, suggestion: SUGGESTIONS[type], ...extra };
}

/** An Error that carries its type, for throw sites where the catcher decides how to report it. */
function typedError(type, message, options) {
  if (!SUGGESTIONS[type]) throw new Error(`Unknown error type: ${type}`);
  return Object.assign(new Error(message, options), { errorType: type });
}

module.exports = { ERROR_TYPES, SUGGESTIONS, failure, typedError };
