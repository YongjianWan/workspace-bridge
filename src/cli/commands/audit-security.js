const { assembleSecurity } = require('../../tools/audit-assembler');

async function auditSecurityCmd(parsed, container) {
  return assembleSecurity(parsed, container);
}

module.exports = auditSecurityCmd;
