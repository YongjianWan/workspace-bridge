const { buildProjectMap } = require('../formatters');

async function auditMapCmd(parsed, container) {
  await container.ensureReady();
  const result = buildProjectMap(container.depGraph, { compact: parsed.compact });
  const c = result.summary?.issueCounts || {};
  result.hasFindings = (c.deadExports || 0) > 0 || (c.unresolved || 0) > 0 || (c.cycles || 0) > 0 || (c.orphans || 0) > 0 || (c.hotspots || 0) > 0;
  return result;
}

module.exports = auditMapCmd;
