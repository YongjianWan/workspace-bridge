const { buildProjectOverview } = require('../../tools/overview-tools');

async function auditOverviewCmd(parsed, container) {
  const result = await buildProjectOverview(parsed, container);
  if (result.ok !== false) {
    result.hasFindings = (result.orphans?.counts?.total || 0) > 0
      || (result.hotspots?.length || 0) > 0
      || (result.architectureAdvice?.cycleRefactorSuggestions?.length || 0) > 0;
  }
  return result;
}

module.exports = auditOverviewCmd;
