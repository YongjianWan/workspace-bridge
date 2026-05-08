const { repoSeverity } = require('../../config/risk-thresholds');

function buildRepoSummary(health, deadExports, unresolved, cycles, scope) {
  const deadExportCount = deadExports.deadExportCount || 0;
  const unresolvedCount = unresolved.unresolvedCount || 0;
  const cycleCount = cycles.cycleCount || 0;
  const nonMainlineFiles = scope?.counts?.nonMainlineFiles || 0;

  const passedChecks = health.healthScoreNumeric?.passed ?? (Number.parseInt(String(health.healthScore || '0/5').split('/')[0] || '0', 10) || 0);
  const totalChecks = health.healthScoreNumeric?.total ?? (Number.parseInt(String(health.healthScore || '0/5').split('/')[1] || '5', 10) || 5);
  const missingHygieneChecks = Math.max(0, totalChecks - passedChecks);

  const severity = repoSeverity({
    unresolved: unresolvedCount,
    cycles: cycleCount,
    deadExports: deadExportCount,
    missingHygieneChecks,
  });

  // Honesty metadata: surface false-positive likelihood so users can calibrate trust
  const honesty = {
    deadExports: {
      total: deadExportCount,
      likelyFalsePositives: deadExports.possibleFalsePositives?.count || 0,
      primaryReason: deadExports.possibleFalsePositives?.primaryReason || null,
    },
    unresolved: {
      total: unresolvedCount,
      likelyFalsePositives: unresolved.possibleFalsePositives?.count || 0,
      primaryReason: unresolved.possibleFalsePositives?.primaryReason || null,
    },
    disclaimer: buildCombinedDisclaimer(deadExports.possibleFalsePositives, unresolved.possibleFalsePositives),
  };

  const nextSteps = buildNextSteps({
    unresolvedCount,
    cycleCount,
    deadExportCount,
    missingHygieneChecks,
    nonMainlineFiles,
    unresolvedFp: unresolved.possibleFalsePositives,
    deadExportsFp: deadExports.possibleFalsePositives,
  });

  return {
    severity,
    counts: {
      deadExports: deadExportCount,
      unresolved: unresolvedCount,
      cycles: cycleCount,
      missingHygieneChecks,
    },
    honesty,
    nextSteps,
  };
}

function buildCombinedDisclaimer(unresolvedFp, deadExportsFp) {
  const parts = [];
  if (unresolvedFp?.disclaimer) parts.push(unresolvedFp.disclaimer);
  if (deadExportsFp?.disclaimer) parts.push(deadExportsFp.disclaimer);
  return parts.length > 0 ? parts.join(' ') : null;
}

function buildNextSteps(ctx) {
  const steps = [];

  if (ctx.unresolvedCount > 0) {
    const fpRatio = ctx.unresolvedFp?.total > 0 ? (ctx.unresolvedFp.count / ctx.unresolvedFp.total) : 0;
    if (fpRatio >= 0.8 && ctx.unresolvedFp?.primaryReason === 'alias-unresolved') {
      steps.push('Most unresolved imports are alias false positives; check tsconfig.json / jsconfig.json compilerOptions.paths configuration.');
    } else {
      steps.push('Inspect unresolved imports first; they can indicate broken code paths or unsupported alias resolution.');
    }
  }

  if (ctx.cycleCount > 0) {
    steps.push('Break dependency cycles before making broad refactors.');
  }

  if (ctx.deadExportCount > 0) {
    const fpRatio = ctx.deadExportsFp?.total > 0 ? (ctx.deadExportsFp.count / ctx.deadExportsFp.total) : 0;
    if (fpRatio >= 0.5) {
      steps.push(`Review dead exports carefully; about ${Math.round(fpRatio * 100)}% are likely false positives (${ctx.deadExportsFp?.primaryReason || 'unknown'}).`);
    } else {
      steps.push('Review dead exports as candidates, not automatic deletions.');
    }
  }

  if (ctx.missingHygieneChecks > 0) {
    steps.push('Close basic project hygiene gaps: LICENSE, CI, test config, env example, or editorconfig.');
  }

  if (ctx.nonMainlineFiles > 0) {
    steps.push('Review the mainline/non-mainline split before trusting structural findings in mixed repositories.');
  }

  if (steps.length === 0) {
    steps.push('No immediate structural issues detected by the aggregate audit.');
  }

  return steps;
}

module.exports = { buildRepoSummary };
