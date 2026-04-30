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
};

module.exports = {
  TIMEOUTS,
  LIMITS,
  DEFAULTS,
};
