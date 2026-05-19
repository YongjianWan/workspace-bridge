const { buildProjectMap } = require('../formatters');

async function auditMapCmd(parsed, container) {
  await container.ensureReady();
  return buildProjectMap(container.depGraph, { compact: parsed.compact });
}

module.exports = auditMapCmd;
