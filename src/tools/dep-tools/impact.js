const path = require('path');
const { DEFAULTS } = require('../../config/constants');
const { getCoChangePartners } = require('../cochange-tools');

async function impact(args, container, filePath) {
  const impactDepth = Number.isFinite(args?.maxDepth) ? Math.max(1, args.maxDepth) : DEFAULTS.AFFECTED_TEST_DEPTH;
  const impact = container.depGraph.getImpactRadius(filePath, impactDepth);
  const symbolImpact = container.depGraph.getSymbolImpact(filePath);
  let coChangeData = container.cache?.coChanges || null;
  if (!coChangeData && container.ensurePrecomputed) {
    await container.ensurePrecomputed(['cochanges']);
    coChangeData = container.cache?.coChanges || null;
  }
  const relativeFile = path.relative(container.workspaceRoot, filePath).replace(/\\/g, '/');
  const coChanges = coChangeData ? getCoChangePartners(relativeFile, coChangeData, { minCount: 2, partnerLimit: 10 }) : [];
  return {
    ok: true,
    file: args.file,
    resolvedPath: container.depGraph._displayPath?.(filePath) || filePath,
    impactCount: impact.length,
    impact,
    symbolImpact,
    coChanges,
  };
}

module.exports = impact;
