const { fileImpactSeverity } = require('../../config/risk-thresholds');

function buildFileSummary(impact, affectedTests) {
  const impactCount = impact.impactCount || 0;
  const affectedTestCount = affectedTests.affectedTestCount || 0;

  const severity = fileImpactSeverity(impactCount, affectedTestCount);

  const nextSteps = [];
  if (impactCount > 0) nextSteps.push('Review direct and transitive dependents before changing this file.');
  if (affectedTestCount > 0) nextSteps.push('Run the affected tests after the change.');
  if (nextSteps.length === 0) nextSteps.push('No dependent files or affected tests were detected by the graph.');

  return {
    severity,
    severityContext: 'impact-radius',
    severityNote: 'This severity reflects blast radius (dependents + affected tests), not code quality defects.',
    counts: {
      impact: impactCount,
      affectedTests: affectedTestCount,
    },
    nextSteps,
  };
}

module.exports = { buildFileSummary };
