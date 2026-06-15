const path = require('path');
const { DEFAULTS } = require('../../config/constants');
const { getCoChangePartners } = require('../cochange-tools');
const { truncateArray } = require('../../utils/truncate');

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

  // Wave 9-2: collect affected routes from impacted files (graph-first!)
  const affectedRoutes = container.snapshot.graph.findAffectedHttpRoutes(filePath, args?.maxDepth);

  // Wave 12-1/12-5: honest truncation. --max-files overrides the default
  // JSON cap so users can explicitly request a tighter bound.
  const impactLimit = Number.isFinite(args?.maxFiles) ? args.maxFiles : DEFAULTS.JSON_OUTPUT_MAX_IMPACT_ITEMS;
  const impactTrunc = truncateArray(impact, impactLimit);
  const coChangesTrunc = truncateArray(coChanges, DEFAULTS.JSON_OUTPUT_MAX_COCHANGE_ITEMS);
  const affectedRoutesTrunc = truncateArray(affectedRoutes, DEFAULTS.JSON_OUTPUT_MAX_AFFECTED_ROUTES_ITEMS);

  return {
    ok: true,
    file: args.file,
    resolvedPath: container.snapshot.graph._displayPath?.(filePath) || filePath,
    impactCount: impact.length,
    impact: impactTrunc.items,
    symbolImpact,
    coChanges: coChangesTrunc.items,
    affectedRoutes: affectedRoutesTrunc.items,
    truncated: impactTrunc.truncated || coChangesTrunc.truncated || affectedRoutesTrunc.truncated,
  };
}

module.exports = impact;
