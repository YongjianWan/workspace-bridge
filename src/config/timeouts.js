/**
 * Timeout constants for external commands, subprocesses, and long-running operations.
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
  // Watch --run-tests mode: single validation command timeout.
  // 60s covers most test suites for a focused set; kill if hung.
  WATCH_COMMAND_TIMEOUT_MS: 60000,

  // Diagnostics-specific timeouts (consolidated from diagnostics-engine.js + workspace-tools.js)
  // Short: linter version probes and git-status fallback.
  DIAGNOSTICS_SHORT_MS: 10000,
  // Medium: type-checker single-file checks and pytest --version.
  DIAGNOSTICS_MEDIUM_MS: 15000,
  // Standard check: ruff/eslint full run on the workspace.
  DIAGNOSTICS_CHECK_MS: 30000,
  // Long: pyright full workspace type-check.
  DIAGNOSTICS_LONG_MS: 60000,
  // Total budget for runDiagnostics; must exceed sum of individual check timeouts.
  DIAGNOSTICS_TOTAL_MS: 120000,

  // Test runner thresholds
  TEST_RUNNER_MS: 180000,
  TEST_RUNNER_KILL_GRACE_MS: 5000,
  TEST_SLOW_THRESHOLD_MS: 10000,
};

module.exports = TIMEOUTS;
