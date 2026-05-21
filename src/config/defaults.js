/**
 * Operational defaults with documented rationale.
 */
const DEFAULTS = {
  // affected_tests / impact radius: depth 5 balances coverage vs. explosion.
  // Most real-world test-to-code mappings sit within 1-3 hops.
  AFFECTED_TEST_DEPTH: 5,
  // Symbol-level impact uses 4 because it traverses one fewer hop
  // than file-level (symbol -> file -> test instead of file -> file -> test).
  SYMBOL_IMPACT_DEPTH: 4,
  // File-index recursion cap: 12 directory levels covers Java multi-module
  // projects (src/main/java/com/company/...) while still bounding descent.
  // Dependency directories (node_modules, target, etc.) are excluded separately.
  FILE_INDEX_MAX_DEPTH: 12,
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
  // Compact mode truncation limits — chosen to keep AI-readable output under ~2KB
  // while still surfacing enough signal for action decisions.
  COMPACT_ISSUE_MAX_ITEMS: 10,          // 10 issues = ~300 tokens; beyond that noise dominates signal
  COMPACT_ORPHAN_MAX_ITEMS: 10,         // orphan files are low-priority; cap prevents scroll fatigue
  // Audit-diff auto-compact: trigger when changed files exceed this count.
  // Rationale: 20+ changed files usually means a large PR where per-file detail explodes output.
  AUDIT_DIFF_AUTO_COMPACT_THRESHOLD: 20,
  COMPACT_IMPACT_MAX: 5,                // 5 impact files covers ~90% of typical change radius
  COMPACT_AFFECTED_TESTS_MAX: 5,        // AI rarely needs >5 test files to decide what to run
  COMPACT_EXPLANATIONS_MAX: 3,          // 3 explanations = enough for pattern recognition without repetition
  COMPACT_TOP_COMPOSITE_RISKS: 3,       // top-3 risks preserves P0/P1/P2 priority triage
  // Large-project warning: when edge count exceeds this, prompt user to use --compact.
  // Rationale: 5000 edges ≈ ~300KB JSON (pretty-printed), which exceeds typical AI context budgets.
  LARGE_PROJECT_EDGE_WARNING_THRESHOLD: 5000,
  // Small-project threshold: below this mainline file count, coupling-split advice is noise
  // because the codebase is small enough to be mentally mapped as a single unit.
  SMALL_PROJECT_MAX_MAINLINE: 200,
  // Function reuse hints for audit-diff
  REUSE_HINTS_MIN_SCORE: 0.5,
  REUSE_HINTS_MAX_PER_FUNCTION: 3,
  // File-index timeouts
  FILE_INDEX_PATTERN_TIMEOUT_MS: 120000,
  WATCH_DEBOUNCE_MS: 500,
  FILE_INDEX_BUILD_TIMEOUT_MS: 300000,
  // Staleness threshold: 24 hours suits AI async review workflows.
  STALENESS_THRESHOLD_MS: 24 * 60 * 60 * 1000,
  // Progress report batch size for large repo indexing.
  FILE_INDEX_PROGRESS_BATCH: 100,
  // Diagnostics debounce: 1s balances responsiveness with batching.
  // Too short = excessive re-runs; too long = stale linter feedback.
  DIAGNOSTICS_DEBOUNCE_MS: 1000,
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

module.exports = { DEFAULTS, HIGHLIGHT_SCORES };
