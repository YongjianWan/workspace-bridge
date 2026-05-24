const path = require('path');
const { DEFAULTS } = require('../../config/constants');
const { getCoChangePartners } = require('../cochange-tools');

async function impact(args, container, filePath) {
  const impact = container.snapshot.graph.getImpactRadius(filePath, args?.maxDepth);
  const symbolImpact = container.snapshot.graph.getSymbolImpact(filePath);
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
    resolvedPath: container.snapshot.graph._displayPath?.(filePath) || filePath,
    impactCount: impact.length,
    impact,
    symbolImpact,
    coChanges,
  };
}

module.exports = impact;
