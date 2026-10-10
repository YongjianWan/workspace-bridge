const path = require('path');
const { DEFAULTS } = require('../../config/constants');
const { DATA_QUALITY } = require('../../config/data-quality');
const { warningOf } = require('../../services/ledger');
const { getCoChangePartners } = require('../cochange-tools');
const { truncateArray } = require('../../utils/truncate');

const { failure } = require('../../utils/failure');

const IMPACT_DIRECTIONS = new Set(['dependents', 'dependencies', 'neighbors', 'all']);

async function impact(args, container, filePath) {
  if (args?.direction != null && !IMPACT_DIRECTIONS.has(args.direction)) {
    return failure('validation_error', `Invalid direction: ${args.direction}. Expected one of: ${[...IMPACT_DIRECTIONS].join(', ')}`);
  }
  const impact = container.snapshot.graph.getImpactRadius(filePath, args?.maxDepth, {
    direction: args?.direction || DEFAULTS.IMPACT_DEFAULT_DIRECTION,
    stopAtEntry: args?.stopAtEntry,
  });
  const symbolImpact = container.snapshot.graph.getSymbolImpact(filePath);
  const targetNotIndexed = symbolImpact?.reason === 'source-not-indexed';
  let coChangeData = container.cache?.coChanges || null;
  if (!coChangeData && container.ensurePrecomputed) {
    await container.ensurePrecomputed(['cochanges']);
    coChangeData = container.cache?.coChanges || null;
  }
  const relativeFile = path.relative(container.workspaceRoot, filePath).replace(/\\/g, '/');
  const coChanges = coChangeData ? getCoChangePartners(relativeFile, coChangeData, { minCount: 2, partnerLimit: 10 }) : [];

  // Contamination rule: co-change edges inherit quality from their data source.
  // AST-derived impact edges are always CERTAIN and are not annotated here.
  const coChangesDataQuality = coChangeData?.dataQuality ?? DATA_QUALITY.UNAVAILABLE;
  const coChangesRemediation = coChangeData?.remediation ?? null;

  // Environment degradation applies to the overall impact result because sparse
  // checkout / submodule / LFS / monorepo root can make the graph incomplete.
  const env = container.gitEnvironment || { dataQuality: DATA_QUALITY.CERTAIN, remediation: null };
  const dataQuality = targetNotIndexed ? DATA_QUALITY.DEGRADED : env.dataQuality;
  const environmentRemediation = env.remediation;

  // Wave 9-2: collect affected routes from impacted files (graph-first!)
  const affectedRoutes = container.snapshot.graph.findAffectedHttpRoutes(filePath, args?.maxDepth);

  // Wave 12-1/12-5 + T1.3: honest truncation. Rows stay in BFS order
  // (level asc, dependents → dependencies → neighbors, discovery order) —
  // two J1 replay rounds showed handcrafted relevance keys (level/reason/dir)
  // swing ±1–4pp per edge type against that order without dominating it, so
  // the shipped contract keeps BFS order and only caps the length. The one
  // ordering-adjacent change lives in query.js: the input itself no longer
  // leaks into its own same-importer rows, freeing a slot.
  // --max-files overrides the default relevance cap.
  const impactLimit = Number.isFinite(args?.maxFiles) ? args.maxFiles : DEFAULTS.IMPACT_RELEVANCE_LIMIT;
  const impactTrunc = truncateArray(impact, impactLimit);
  const coChangesTrunc = truncateArray(coChanges, DEFAULTS.JSON_OUTPUT_MAX_COCHANGE_ITEMS);
  const affectedRoutesTrunc = truncateArray(affectedRoutes, DEFAULTS.JSON_OUTPUT_MAX_AFFECTED_ROUTES_ITEMS);

  return {
    ok: true,
    file: args.file,
    resolvedPath: container.snapshot.graph._displayPath(filePath) || filePath,
    impactCount: impact.length,
    ...(targetNotIndexed ? {
      warnings: [warningOf('target-not-indexed', {
        message: 'Target is not in the source index; zero impact does not establish absence of dependents' })] } : {}),
    impact: impactTrunc.items,
    symbolImpact,
    coChanges: coChangesTrunc.items,
    coChangesDataQuality,
    ...(coChangesRemediation ? { coChangesRemediation } : {}),
    affectedRoutes: affectedRoutesTrunc.items,
    truncated: impactTrunc.truncated || coChangesTrunc.truncated || affectedRoutesTrunc.truncated,
    dataQuality,
    ...(environmentRemediation ? { environmentRemediation } : {}),
  };
}

module.exports = impact;
