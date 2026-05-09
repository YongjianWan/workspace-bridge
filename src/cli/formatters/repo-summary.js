const { repoSeverity } = require('../../config/risk-thresholds');

function buildRepoSummary(health, deadExports, unresolved, cycles, scope, stackProfile = 'unknown', analysisCoverage = null, stack = null) {
  const deadExportCount = deadExports.deadExportCount || 0;
  const unresolvedCount = unresolved.unresolvedCount || 0;
  const cycleCount = cycles.cycleCount || 0;
  const nonMainlineFiles = scope?.counts?.nonMainlineFiles || 0;

  const passedChecks = health.healthScoreNumeric?.passed ?? (Number.parseInt(String(health.healthScore || '0/5').split('/')[0] || '0', 10) || 0);
  const totalChecks = health.healthScoreNumeric?.total ?? (Number.parseInt(String(health.healthScore || '0/5').split('/')[1] || '5', 10) || 5);
  const missingHygieneChecks = health.checks
    ? Object.values(health.checks).filter((c) => !c.found).length
    : Math.max(0, totalChecks - passedChecks);

  let severity = repoSeverity({
    unresolved: unresolvedCount,
    cycles: cycleCount,
    deadExports: deadExportCount,
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
  }, stackProfile, stack);

  const result = {
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

  if (ctx.unresolvedCount > 0 && !prioritizeDeadExports) {
    const fpRatio = ctx.unresolvedFp?.total > 0 ? (ctx.unresolvedFp.count / ctx.unresolvedFp.total) : 0;
    if (fpRatio >= 0.8 && ctx.unresolvedFp?.primaryReason === 'alias-unresolved') {
      if (nodeFramework === 'vue') {
        steps.push(`${ctx.unresolvedCount} unresolved imports — ${Math.round(fpRatio * 100)}% are alias/Vue extension omissions (e.g. missing .vue suffix or tsconfig paths not resolved). Check vite.config.js resolve.alias and ensure .vue files are imported with full extension.`);
      } else {
        steps.push(`${ctx.unresolvedCount} unresolved imports — ${Math.round(fpRatio * 100)}% are alias false positives. Check tsconfig.json / jsconfig.json compilerOptions.paths configuration.`);
      }
    } else {
      steps.push(`Inspect ${ctx.unresolvedCount} unresolved import${ctx.unresolvedCount > 1 ? 's' : ''} first; they can indicate broken code paths or unsupported alias resolution.`);
    }
  }

  if (ctx.cycleCount > 0) {
    if (nodeFramework === 'vue') {
      steps.push(`${ctx.cycleCount} dependency cycle${ctx.cycleCount > 1 ? 's' : ''} detected — in Vue projects store→router→view cycles are often intentional design patterns. Review each cycle with 'audit-cycles --json' to distinguish framework-normal from structural debt.`);
    } else {
      steps.push(`Break ${ctx.cycleCount} dependency cycle${ctx.cycleCount > 1 ? 's' : ''} before making broad refactors.`);
    }
  }

  if (ctx.deadExportCount > 0) {
    const fpRatio = ctx.deadExportsFp?.total > 0 ? (ctx.deadExportsFp.count / ctx.deadExportsFp.total) : 0;
    if (fpRatio >= 0.5) {
      let reason = ctx.deadExportsFp?.primaryReason || 'unknown';
      if (nodeFramework === 'vue') {
        reason = 'Vue global components, directives, or lazy-loaded routes';
      } else if (isJava) {
        reason = 'Spring Boot framework entry classes (Application, Configuration, etc.)';
      }
      steps.push(`${ctx.deadExportCount} dead exports — about ${Math.round(fpRatio * 100)}% are likely false positives (${reason}). Review with 'audit-file' before deleting.`);
    } else {
      steps.push(`${ctx.deadExportCount} dead export${ctx.deadExportCount > 1 ? 's' : ''} — review as candidates, not automatic deletions. Run the project's test suite after any removal.`);
    }
  }

  // When prioritizing deadExports, put unresolved after deadExports
  if (ctx.unresolvedCount > 0 && prioritizeDeadExports) {
    const fpRatio = ctx.unresolvedFp?.total > 0 ? (ctx.unresolvedFp.count / ctx.unresolvedFp.total) : 0;
    if (fpRatio >= 0.8 && ctx.unresolvedFp?.primaryReason === 'alias-unresolved') {
      steps.push(`${ctx.unresolvedCount} unresolved imports — ${Math.round(fpRatio * 100)}% are alias false positives. Check tsconfig.json / jsconfig.json compilerOptions.paths configuration.`);
    } else {
      steps.push(`Inspect ${ctx.unresolvedCount} unresolved import${ctx.unresolvedCount > 1 ? 's' : ''}; they can indicate broken code paths or unsupported alias resolution.`);
    }
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
    steps.push(`Review mainline/non-mainline split (${ctx.nonMainlineFiles} non-mainline files) before trusting structural findings in mixed repositories.`);
  }

  if (steps.length === 0) {
    steps.push('No immediate structural issues detected by the aggregate audit.');
  }

  return steps;
}

module.exports = { buildRepoSummary };
