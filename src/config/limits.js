/**
 * Resource limits: buffers, cache sizes, concurrency caps.
 */
const LIMITS = {
  COMMAND_OUTPUT_MAX_BYTES: 10 * 1024 * 1024,
  EXEC_SYNC_MAX_BUFFER_BYTES: 4 * 1024 * 1024,
  WATCH_MAX_STDOUT_BYTES: 1 * 1024 * 1024,
  TRIM_OUTPUT_DEFAULT_CHARS: 12000,
  SEARCH_MAX_FILE_BYTES: 1024 * 1024,
  // Files larger than this are skipped by the AST parser to avoid OOM.
  PARSER_MAX_FILE_BYTES: 1024 * 1024,
  ENTRY_FILE_MAX_BYTES: 64 * 1024,
  ENTRY_SCAN_BYTES: 4096,
  RESOLVER_STAT_CACHE_MAX: 2000,
  SCAN_SYMBOL_CONTENT_CACHE_MAX: 2000,
  GIT_STAT_MAX_CHARS: 8000,
  GIT_PATCH_MAX_CHARS: 12000,
  GIT_FILE_LIST_MAX: 500,
  GIT_COMMIT_MAX: 10,
  GIT_BRANCH_MAX: 10,
  GIT_LOG_MAX: 100,
  GIT_AUTHOR_MAX_LENGTH: 100,
  LINTER_OUTPUT_MAX_CHARS: 3000,
  // Parser concurrency: cap Python sub-processes to prevent memory spikes
  // on large Java/Python repositories. Each Python process uses 30-80MB.
  PYTHON_AST_CONCURRENCY: 4,
  // Git history concurrency: cap parallel git log --follow to prevent
  // disk/CPU thrashing during hotspot analysis.
  GIT_LOG_CONCURRENCY: 8,
  // Cycle finder recursion limit
  CYCLE_FINDER_MAX_CALLS: 20000,
};

module.exports = LIMITS;
