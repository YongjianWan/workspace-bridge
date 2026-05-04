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
  // Container initialization: file indexing + dep-graph build + cache warm.
  // Large repos (10k+ files) may need the full minute.
  INIT_TIMEOUT_MS: 60000,
};

const LIMITS = {
  COMMAND_OUTPUT_MAX_BYTES: 10 * 1024 * 1024,
  EXEC_SYNC_MAX_BUFFER_BYTES: 4 * 1024 * 1024,
  TRIM_OUTPUT_DEFAULT_CHARS: 12000,
  SEARCH_MAX_FILE_BYTES: 1024 * 1024,
};

// Operational defaults with documented rationale
const DEFAULTS = {
  // affected_tests / impact radius: depth 5 balances coverage vs. explosion.
  // Most real-world test-to-code mappings sit within 1-3 hops.
  AFFECTED_TEST_DEPTH: 5,
  // Symbol-level impact uses 4 because it traverses one fewer hop
  // than file-level (symbol -> file -> test instead of file -> file -> test).
  SYMBOL_IMPACT_DEPTH: 4,
  // File-index recursion cap: 5 directory levels avoids infinite descent
  // in deeply-nested dependency directories while covering normal src trees.
  FILE_INDEX_MAX_DEPTH: 5,
  // Hotspot analysis budget: limit history queries to avoid Git churn
  // on monorepos with thousands of mainline files.
  HOTSPOT_CANDIDATE_LIMIT: 50,
  // Stability analysis budget: smaller than hotspots because it runs
  // synchronously without history provider overhead.
  STABILITY_CANDIDATE_LIMIT: 30,
  // Coupling split suggestion threshold: library files below this total
  // degree are too small to be actionable split candidates.
  COUPLING_SPLIT_MIN_TOTAL: 8,
  // Watch mode impact radius: shallow enough to be readable,
  // deep enough to show meaningful dependents.
  WATCH_IMPACT_DEPTH: 3,
  // audit-diff concurrency: how many changed files to process in parallel
  // without overwhelming the event loop or file descriptors.
  CLI_CONCURRENCY: 8,
  // Git history query budget: number of recent commits to fetch per file.
  // Larger values improve hotspot accuracy but slow down audit-diff/overview.
  HISTORY_LIMIT: 25,
  // Minimum code ratio for a mixed change to be classified as "code".
  // Below this threshold, docs/tests/config/scripts may dominate.
  CODE_CHANGE_RATIO_THRESHOLD: 0.2,
};

// Scoring weights for highlighted files in compact project map.
// Higher = more severe, drives sorting and truncation decisions.
const HIGHLIGHT_SCORES = {
  unresolved: 100,
  cycle: 80,
  'dead-export': 60,
  orphan: 40,
  hotspot: 20,
  entry: 0,
};

module.exports = {
  TIMEOUTS,
  LIMITS,
  DEFAULTS,
  HIGHLIGHT_SCORES,
};
