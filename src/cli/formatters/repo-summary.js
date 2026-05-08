const { repoSeverity } = require('../../config/risk-thresholds');

function buildRepoSummary(health, deadExports, unresolved, cycles, scope, stackProfile = 'unknown') {
  const deadExportCount = deadExports.deadExportCount || 0;
  const unresolvedCount = unresolved.unresolvedCount || 0;
  const cycleCount = cycles.cycleCount || 0;
  const nonMainlineFiles = scope?.counts?.nonMainlineFiles || 0;

  const passedChecks = health.healthScoreNumeric?.passed ?? (Number.parseInt(String(health.healthScore || '0/5').split('/')[0] || '0', 10) || 0);
  const totalChecks = health.healthScoreNumeric?.total ?? (Number.parseInt(String(health.healthScore || '0/5').split('/')[1] || '5', 10) || 5);
  const missingHygieneChecks = health.checks
    ? Object.values(health.checks).filter((c) => !c.found).length
    : Math.max(0, totalChecks - passedChecks);

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
  }, stackProfile);

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

function buildNextSteps(ctx, stackProfile = 'unknown') {
  const steps = [];

  // Stack-specific prioritization: reorder steps based on dominant stack
  const isNode = stackProfile === 'node-first' || stackProfile === 'mixed';
  const isJava = stackProfile === 'java-first';
  const isPython = stackProfile === 'python-first';

  // For Java/Python, deadExports are more actionable than unresolved (alias issues are rare)
  const prioritizeDeadExports = isJava || isPython;

  if (ctx.unresolvedCount > 0 && !prioritizeDeadExports) {
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

  // When prioritizing deadExports, put unresolved after deadExports
  if (ctx.unresolvedCount > 0 && prioritizeDeadExports) {
    const fpRatio = ctx.unresolvedFp?.total > 0 ? (ctx.unresolvedFp.count / ctx.unresolvedFp.total) : 0;
    if (fpRatio >= 0.8 && ctx.unresolvedFp?.primaryReason === 'alias-unresolved') {
      steps.push('Most unresolved imports are alias false positives; check tsconfig.json / jsconfig.json compilerOptions.paths configuration.');
    } else {
      steps.push('Inspect unresolved imports; they can indicate broken code paths or unsupported alias resolution.');
    }
  }

  if (ctx.missingHygieneChecks > 0) {
    if (isNode) {
      steps.push('Close basic project hygiene gaps: CI workflow, test config (Vitest/Jest), env example, and editorconfig.');
    } else if (isJava) {
      steps.push('Close basic project hygiene gaps: Maven/Gradle wrapper, CI workflow, test config (JUnit), and editorconfig.');
    } else if (isPython) {
      steps.push('Close basic project hygiene gaps: pytest config, requirements/pyproject, CI workflow, and editorconfig.');
    } else {
      steps.push('Close basic project hygiene gaps: LICENSE, CI, test config, env example, or editorconfig.');
    }
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
