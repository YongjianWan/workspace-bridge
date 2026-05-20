const { assembleDiff } = require('../../tools/audit-assembler');

async function auditDiffCmd(parsed, container) {
  return assembleDiff(parsed, container);
}

module.exports = auditDiffCmd;
