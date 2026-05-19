const { buildProjectOverview } = require('../../tools/overview-tools');

async function auditOverviewCmd(parsed, container) {
  return buildProjectOverview(parsed, container);
}

module.exports = auditOverviewCmd;
