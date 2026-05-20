const { assembleSummary } = require('../../tools/audit-assembler');

async function auditSummaryCmd(parsed, container) {
  return assembleSummary(parsed, container);
}

module.exports = auditSummaryCmd;
