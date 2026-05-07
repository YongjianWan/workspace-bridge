/**
 * Shared runtime constants.
 * Keep operational thresholds in one place to reduce magic-number drift.
 */
const TIMEOUTS = {
  COMMAND_DEFAULT_MS: 120000,
  COMMAND_EXISTS_CHECK_MS: 5000,
  GIT_DEFAULT_MS: 30000,
  GIT_SHORT_MS: 15000,
  GIT_LONG_MS: 30000,
  PYTHON_MODULE_DEFAULT_MS: 30000,
  NPX_DEFAULT_MS: 30000,
  PYTHON_AST_PARSE_MS: 30000,
  PYTHON_AST_SIGKILL_DELAY_MS: 5000,
  CONTAINER_ENSURE_READY_TIMEOUT_MS: 30000,
  // Container initialization: file indexing + dep-graph build + cache warm.
  // Large repos (10k+ files) may need the full minute.
  INIT_TIMEOUT_MS: 60000,
  // Health / linter commands: most formatters and checkers finish within a minute.
  HEALTH_COMMAND_TIMEOUT_MS: 60000,
  // Version-check calls are lightweight; 15s covers slow Python startup.
  HEALTH_SHORT_TIMEOUT_MS: 15000,
  // Security audit tools may need network; 45s is conservative.
  HEALTH_AUDIT_TIMEOUT_MS: 45000,
  // Very quick checks (npm config get, etc.)
  HEALTH_QUICK_TIMEOUT_MS: 5000,
};

const LIMITS = {
  COMMAND_OUTPUT_MAX_BYTES: 10 * 1024 * 1024,
  EXEC_SYNC_MAX_BUFFER_BYTES: 4 * 1024 * 1024,
  TRIM_OUTPUT_DEFAULT_CHARS: 12000,
  SEARCH_MAX_FILE_BYTES: 1024 * 1024,
  ENTRY_FILE_MAX_BYTES: 64 * 1024,
  ENTRY_SCAN_BYTES: 256,
  RESOLVER_STAT_CACHE_MAX: 2000,
  GIT_STAT_MAX_CHARS: 8000,
  GIT_PATCH_MAX_CHARS: 12000,
  GIT_FILE_LIST_MAX: 500,
  GIT_COMMIT_MAX: 10,
  GIT_BRANCH_MAX: 10,
  GIT_LOG_MAX: 100,
  GIT_AUTHOR_MAX_LENGTH: 100,
  LINTER_OUTPUT_MAX_CHARS: 3000,
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
  // REPL display limits
  REPL_ISSUES_LIMIT: 3,
  REPL_TOP_LIMIT: 2,
  PROJECT_MAP_HIGHLIGHT_MAX: 30,
  // Audit-diff compact thresholds
  AUDIT_DIFF_AUTO_COMPACT_THRESHOLD: 20,
  COMPACT_IMPACT_MAX: 5,
  COMPACT_AFFECTED_TESTS_MAX: 5,
  COMPACT_EXPLANATIONS_MAX: 3,
  COMPACT_TOP_COMPOSITE_RISKS: 3,
  // Function reuse hints for audit-diff
  REUSE_HINTS_MIN_SCORE: 0.5,
  REUSE_HINTS_MAX_PER_FUNCTION: 3,
  // File-index timeouts
  FILE_INDEX_PATTERN_TIMEOUT_MS: 120000,
  WATCH_DEBOUNCE_MS: 500,
  FILE_INDEX_BUILD_TIMEOUT_MS: 300000,
  // Staleness threshold: 5 minutes balances freshness with cache hit rate.
  STALENESS_THRESHOLD_MS: 5 * 60 * 1000,
  // Progress report batch size for large repo indexing.
  FILE_INDEX_PROGRESS_BATCH: 100,
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

const SCORING = {
  // Hotspot scoring
  HOTSPOT_COMMIT_COUNT_CAP: 10,
  HOTSPOT_COMMIT_COUNT_WEIGHT: 2,
  HOTSPOT_AUTHOR_COUNT_FALLBACK: 1,
  HOTSPOT_AUTHOR_COUNT_WEIGHT: 3,
  HOTSPOT_LAST_MODIFIED_DAYS_CAP: 30,
  HOTSPOT_LAST_MODIFIED_DAYS_MULTIPLIER: 0.5,
  HOTSPOT_REVERT_COUNT_FALLBACK: 0,
  HOTSPOT_REVERT_COUNT_WEIGHT: 5,
  HOTSPOT_SCORE_MAX: 100,
  HOTSPOT_REPORT_THRESHOLD: 30,
  HOTSPOT_MIN_DEPENDENTS: 5,

  // Stability scoring
  STABILITY_BASE_SCORE: 50,
  STABILITY_HAS_TESTS_DELTA: 20,
  STABILITY_LOW_IMPACT_DELTA: 10,
  STABILITY_HIGH_IMPACT_DELTA: -10,
  STABILITY_NON_MAINLINE_DELTA: -10,
  STABILITY_IN_CYCLE_DELTA: -15,
  STABILITY_CONFIG_ROLE_DELTA: 10,
  STABILITY_SCORE_MIN: 0,
  STABILITY_SCORE_MAX: 100,
  STABILITY_FRAGILE_THRESHOLD: 40,
  STABILITY_STABLE_THRESHOLD: 70,

  // Coupling thresholds
  COUPLING_HIGH_MIN: 20,
  COUPLING_MEDIUM_MIN: 10,

  // Core module detection
  CORE_MODULE_MIN_DEPENDENTS: 3,

  // Edge break scoring
  BREAK_EDGE_DEPENDENT_WEIGHT: 2,

  // Sampling / display limits
  TOP_N_RECOMMENDATIONS: 3,
  TOP_N_LIST: 10,
};

module.exports = {
  TIMEOUTS,
  LIMITS,
  DEFAULTS,
  HIGHLIGHT_SCORES,
  SCORING,
};
