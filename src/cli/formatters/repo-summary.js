const { repoSeverity } = require('../../config/risk-thresholds');

function buildRepoSummary(health, deadExports, unresolved, cycles, scope) {
  const deadExportCount = deadExports.deadExportCount || 0;
  const unresolvedCount = unresolved.unresolvedCount || 0;
  const cycleCount = cycles.cycleCount || 0;
  const nonMainlineFiles = scope?.counts?.nonMainlineFiles || 0;

  const scoreParts = String(health.healthScore || '0/5').split('/');
  const passedChecks = Number.parseInt(scoreParts[0] || '0', 10) || 0;
  const totalChecks = Number.parseInt(scoreParts[1] || '5', 10) || 5;
  const missingHygieneChecks = Math.max(0, totalChecks - passedChecks);

  const severity = repoSeverity({
    unresolved: unresolvedCount,
    cycles: cycleCount,
    deadExports: deadExportCount,
    missingHygieneChecks,
  });

  const nextSteps = [];
  if (unresolvedCount > 0) nextSteps.push('Inspect unresolved imports first; they can indicate broken code paths or unsupported alias resolution.');
  if (cycleCount > 0) nextSteps.push('Break dependency cycles before making broad refactors.');
  if (deadExportCount > 0) nextSteps.push('Review dead exports as candidates, not automatic deletions.');
  if (missingHygieneChecks > 0) nextSteps.push('Close basic project hygiene gaps: LICENSE, CI, test config, env example, or editorconfig.');
  if (nonMainlineFiles > 0) nextSteps.push('Review the mainline/non-mainline split before trusting structural findings in mixed repositories.');
  if (nextSteps.length === 0) nextSteps.push('No immediate structural issues detected by the aggregate audit.');

  return {
    severity,
    counts: {
      deadExports: deadExportCount,
      unresolved: unresolvedCount,
      cycles: cycleCount,
      missingHygieneChecks,
    },
    nextSteps,
  };
}

module.exports = { buildRepoSummary };
