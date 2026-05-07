/**
 * Unified risk severity thresholds.
 *
 * Problem this solves: the same concept (severity) was computed with
 * different hard-coded cutoffs in audit-formatters.js, git-tools.js
 * and overview-tools.js, causing a change to show different risk
 * levels depending on which command produced the output.
 *
 * Rules:
 * - Keep only thresholds here, no business logic about *why* a score
 *   is calculated a certain way.
 * - Callers pass raw counts/scores; this module maps them to levels.
 */

const SCORE = {
  HIGH: 6,
  MEDIUM: 3,
};

function toFinite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function scoreToLevel(score) {
  const n = toFinite(score);
  if (n >= SCORE.HIGH) return 'high';
  if (n >= SCORE.MEDIUM) return 'medium';
  return 'low';
}

// File-level impact severity (used by buildFileSummary and buildAuditDiffSummary)
const FILE_IMPACT = {
  HIGH_IMPACT_COUNT: 10,
  HIGH_AFFECTED_TEST_COUNT: 5,
  MEDIUM_IMPACT_COUNT: 1,
  MEDIUM_AFFECTED_TEST_COUNT: 1,
};

function fileImpactSeverity(impactCount, affectedTestCount) {
  const impact = toFinite(impactCount);
  const tests = toFinite(affectedTestCount);
  if (impact >= FILE_IMPACT.HIGH_IMPACT_COUNT || tests >= FILE_IMPACT.HIGH_AFFECTED_TEST_COUNT) {
    return 'high';
  }
  if (impact >= FILE_IMPACT.MEDIUM_IMPACT_COUNT || tests >= FILE_IMPACT.MEDIUM_AFFECTED_TEST_COUNT) {
    return 'medium';
  }
  return 'low';
}

// Repo-level severity (used by buildRepoSummary)
const REPO = {
  HIGH_UNRESOLVED_MIN: 1,
  HIGH_CYCLES_MIN: 1,
  MEDIUM_DEAD_EXPORTS_MIN: 1,
  MEDIUM_MISSING_HYGIENE_MIN: 3,
};

function repoSeverity({ unresolved = 0, cycles = 0, deadExports = 0, missingHygieneChecks = 0 }) {
  if (unresolved >= REPO.HIGH_UNRESOLVED_MIN || cycles >= REPO.HIGH_CYCLES_MIN) {
    return 'high';
  }
  if (deadExports >= REPO.MEDIUM_DEAD_EXPORTS_MIN || missingHygieneChecks >= REPO.MEDIUM_MISSING_HYGIENE_MIN) {
    return 'medium';
  }
  return 'low';
}

// Diff-level severity (used by buildAuditDiffSummary)
const DIFF = {
  HIGH_AFFECTED_TESTS_MIN: 5,
  MEDIUM_MAX_IMPACT_MIN: 1,
  MEDIUM_MAX_HISTORY_SCORE_MIN: 3,
  MEDIUM_MAX_COMPOSITE_SCORE_MIN: 3,
};

function diffSeverity({
  highRiskFileCount = 0,
  affectedTestCount = 0,
  highHistoryRiskFileCount = 0,
  highCompositeRiskFileCount = 0,
  mainlineChangedCount = 0,
  maxImpact = 0,
  maxHistoryRiskScore = 0,
  maxCompositeRiskScore = 0,
}) {
  if (
    highRiskFileCount > 0 ||
    affectedTestCount >= DIFF.HIGH_AFFECTED_TESTS_MIN ||
    highHistoryRiskFileCount > 0 ||
    highCompositeRiskFileCount > 0
  ) {
    return 'high';
  }
  if (
    mainlineChangedCount > 0 &&
    (affectedTestCount > 0 ||
      maxImpact >= DIFF.MEDIUM_MAX_IMPACT_MIN ||
      maxHistoryRiskScore >= DIFF.MEDIUM_MAX_HISTORY_SCORE_MIN ||
      maxCompositeRiskScore >= DIFF.MEDIUM_MAX_COMPOSITE_SCORE_MIN)
  ) {
    return 'medium';
  }
  return 'low';
}

// Overview-level severity (used by buildOverviewSummary)
const OVERVIEW = {
  MEDIUM_FRAGILE_MODULES_MIN: 1,
  HIGH_UNRESOLVED_MIN: 1,
  HIGH_CYCLES_MIN: 1,
  MEDIUM_DEAD_EXPORTS_MIN: 1,
  MEDIUM_ORPHANS_MIN: 5,
};

function overviewSeverity({ fragileModuleCount = 0, unresolved = 0, cycles = 0, deadExports = 0, orphans = 0 }) {
  if (unresolved >= OVERVIEW.HIGH_UNRESOLVED_MIN || cycles >= OVERVIEW.HIGH_CYCLES_MIN) {
    return 'high';
  }
  if (fragileModuleCount >= OVERVIEW.MEDIUM_FRAGILE_MODULES_MIN || deadExports >= OVERVIEW.MEDIUM_DEAD_EXPORTS_MIN || orphans >= OVERVIEW.MEDIUM_ORPHANS_MIN) {
    return 'medium';
  }
  return 'low';
}

module.exports = {
  SCORE,
  FILE_IMPACT,
  REPO,
  DIFF,
  OVERVIEW,
  scoreToLevel,
  fileImpactSeverity,
  repoSeverity,
  diffSeverity,
  overviewSeverity,
};
