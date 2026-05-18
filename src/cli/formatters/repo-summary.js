const { repoSeverity } = require('../../config/risk-thresholds');
const {
  buildUnresolvedRecommendation,
  buildCycleRecommendation,
  buildDeadExportRecommendation,
} = require('../../utils/recommendations');

function buildRepoSummary(health, deadExports, unresolved, cycles, scope, stackProfile = 'unknown', analysisCoverage = null, stack = null) {
  const deadExportsCount = deadExports.deadExportsCount || 0;
  const unresolvedCount = unresolved.unresolvedCount || 0;
  const cyclesCount = cycles.cyclesCount || 0;
  const nonMainlineFiles = scope?.counts?.nonMainlineFiles || 0;

  const passedChecks = health.healthScoreNumeric?.passed ?? (Number.parseInt(String(health.healthScore || '0/5').split('/')[0] || '0', 10) || 0);
  const totalChecks = health.healthScoreNumeric?.total ?? (Number.parseInt(String(health.healthScore || '0/5').split('/')[1] || '5', 10) || 5);
  const missingHygieneChecks = health.checks
    ? Object.values(health.checks).filter((c) => !c.found).length
    : Math.max(0, totalChecks - passedChecks);

  let severity = repoSeverity({
    unresolved: unresolvedCount,
    cycles: cyclesCount,
    deadExports: deadExportsCount,
    missingHygieneChecks,
  });

  // P51: escalate severity when analysis coverage is dangerously low to prevent
  // the "all zeros = all good" false-safety illusion.
  let coverageWarning = null;
  if (analysisCoverage && analysisCoverage.coverageRatio < 0.5) {
    severity = 'high';
    coverageWarning = `Analysis coverage is low (${Math.round(analysisCoverage.coverageRatio * 100)}%); findings may be incomplete`;
  }

  // Honesty metadata: surface false-positive likelihood so users can calibrate trust
  const { SCAFFOLD_REASON_PREFIX } = require('../../utils/scaffold-detector');
  const deadFp = deadExports.possibleFalsePositives || {};
  const scaffoldCount = (deadFp.reasons || []).reduce((sum, r) => {
    if (r.reason && r.reason.startsWith(SCAFFOLD_REASON_PREFIX)) return sum + r.count;
    return sum;
  }, 0);
  const honesty = {
    deadExports: {
      total: deadExportsCount,
      likelyFalsePositives: deadFp.count || 0,
      primaryReason: deadFp.primaryReason || null,
      scaffoldDeadExports: scaffoldCount,
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
    cyclesCount,
    deadExportsCount,
    missingHygieneChecks,
    nonMainlineFiles,
    totalFiles: scope?.counts?.totalFiles || 0,
    unresolvedFp: unresolved.possibleFalsePositives,
    deadExportsFp: deadExports.possibleFalsePositives,
  }, stackProfile, stack);

  const result = {
    severity,
    counts: {
      deadExports: deadExportsCount,
      unresolved: unresolvedCount,
      cycles: cyclesCount,
      missingHygieneChecks,
    },
    honesty,
    nextSteps,
  };

  if (analysisCoverage) {
    result.analysisCoverage = analysisCoverage;
  }
  if (coverageWarning) {
    result.coverageWarning = coverageWarning;
  }

  return result;
}

function buildCombinedDisclaimer(unresolvedFp, deadExportsFp) {
  const parts = [];
  if (unresolvedFp?.disclaimer) parts.push(unresolvedFp.disclaimer);
  if (deadExportsFp?.disclaimer) parts.push(deadExportsFp.disclaimer);
  return parts.length > 0 ? parts.join(' ') : null;
}

function buildNextSteps(ctx, stackProfile = 'unknown', stack = null) {
  const steps = [];

  // Stack-specific prioritization: reorder steps based on dominant stack
  const isNode = stackProfile === 'node-first' || stackProfile === 'mixed';
  const isJava = stackProfile === 'java-first';
  const isPython = stackProfile === 'python-first';

  // Framework detection for actionable, specific advice
  const nodeFramework = stack?.node?.framework || null;
  const pythonFramework = stack?.python?.framework || null;

  // For Java/Python, deadExports are more actionable than unresolved (alias issues are rare)
  const prioritizeDeadExports = isJava || isPython;

  const unresolvedRec = buildUnresolvedRecommendation(ctx.unresolvedCount, ctx.unresolvedFp, stack);
  const cycleRec = buildCycleRecommendation(ctx.cyclesCount, stack);
  const deadExportRec = buildDeadExportRecommendation(ctx.deadExportsCount, ctx.deadExportsFp, stack);

  if (unresolvedRec && !prioritizeDeadExports) {
    steps.push(unresolvedRec);
  }
  if (cycleRec) {
    steps.push(cycleRec);
  }
  if (deadExportRec) {
    steps.push(deadExportRec);
  }
  if (unresolvedRec && prioritizeDeadExports) {
    steps.push(unresolvedRec);
  }

  if (ctx.missingHygieneChecks > 0) {
    if (isNode) {
      const testHint = stack?.node?.testRunner ? `test config (${stack.node.testRunner})` : 'test config';
      steps.push(`Close ${ctx.missingHygieneChecks} hygiene gap${ctx.missingHygieneChecks > 1 ? 's' : ''}: CI workflow, ${testHint}, env example, and editorconfig.`);
    } else if (isJava) {
      steps.push(`Close ${ctx.missingHygieneChecks} hygiene gap${ctx.missingHygieneChecks > 1 ? 's' : ''}: Maven/Gradle wrapper, CI workflow, test config (JUnit), and editorconfig.`);
    } else if (isPython) {
      const testHint = pythonFramework === 'django' ? 'test config (pytest / manage.py test)' : 'test config (pytest)';
      steps.push(`Close ${ctx.missingHygieneChecks} hygiene gap${ctx.missingHygieneChecks > 1 ? 's' : ''}: ${testHint}, requirements/pyproject, CI workflow, and editorconfig.`);
    } else {
      steps.push(`Close ${ctx.missingHygieneChecks} hygiene gap${ctx.missingHygieneChecks > 1 ? 's' : ''}: LICENSE, CI, test config, env example, or editorconfig.`);
    }
  }

  if (ctx.nonMainlineFiles > 0) {
    steps.push(`Note: totalFiles counts only parseable source files; assets, build artifacts, and excluded directories are not included. Review mainline/non-mainline split (${ctx.nonMainlineFiles} non-mainline files) before trusting structural findings in mixed repositories.`);
  } else if (ctx.totalFiles > 0) {
    steps.push('Note: totalFiles counts only parseable source files; assets, build artifacts, and excluded directories are not included.');
  }

  if (steps.length === 0) {
    steps.push('No immediate structural issues detected by the aggregate audit.');
  }

  return steps;
}

module.exports = { buildRepoSummary };
