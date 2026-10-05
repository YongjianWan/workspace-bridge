const { fileImpactSeverity } = require('../../config/risk-thresholds');

function buildFileSummary(impact, affectedTests) {
  const impactCount = impact.impactCount || 0;
  const affectedTestsCount = affectedTests.affectedTestsCount || 0;

  const severity = fileImpactSeverity(impactCount, affectedTestsCount);

  const nextSteps = [];
  if (impactCount > 0) nextSteps.push('Review direct and transitive dependents before changing this file.');
  if (affectedTestsCount > 0) nextSteps.push('Run the affected tests after the change.');
  if (nextSteps.length === 0) nextSteps.push('No dependent files or affected tests were detected by the graph.');

  return {
    severity,
    severityContext: 'impact-radius',
    severityNote: 'This severity reflects blast radius (dependents + affected tests), not code quality defects.',
    counts: {
      impact: impactCount,
      affectedTests: affectedTestsCount,
    },
    nextSteps,
  };
}

module.exports = { buildFileSummary };
