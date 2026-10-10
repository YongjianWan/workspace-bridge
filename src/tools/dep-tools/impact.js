const path = require('path');
const { DEFAULTS } = require('../../config/constants');
const { DATA_QUALITY } = require('../../config/data-quality');
const { warningOf } = require('../../services/ledger');
const { getCoChangePartners } = require('../cochange-tools');
const { truncateArray } = require('../../utils/truncate');

const { failure } = require('../../utils/failure');

const IMPACT_DIRECTIONS = new Set(['dependents', 'dependencies', 'neighbors', 'all']);

// T1.3: 相关性排序的 reason 优先级。直接边 > 邻居 > 传递边 > 弱隐式边 >
// 测试基建；implicit-same-package 是低置信兜底推断，排在传递边之后
// （J1 回放证据：它会在同包实体上成批挤占前 15 名额）。
// 未来新增的 reason 不在表内时垫后（__fallback），保证排序确定性。
const IMPACT_REASON_RANK = {
  'direct-import': 0,
  'direct-reference': 1,
  'same-importer': 2,
  'transitive-dependency': 3,
  'transitive-reference': 4,
  'implicit-same-package': 5,
  'implicit-conftest': 6,
  __fallback: 7,
};

/**
 * 按相关性排序 impact 行：level 升序 → reason 优先级 → 与输入同目录优先 →
 * 路径字母序。路径唯一，最后一键保证确定性（回放可复现）。
 */
function rankImpactRows(rows, workspaceRoot, inputFile) {
  const root = String(workspaceRoot || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const relPosix = (f) => {
    const norm = String(f).replace(/\\/g, '/');
    return norm.startsWith(root + '/') ? norm.slice(root.length + 1) : norm;
  };
  const dirOf = (rel) => {
    const i = rel.lastIndexOf('/');
    return i < 0 ? '' : rel.slice(0, i);
  };
  const inputDir = dirOf(relPosix(inputFile));

  return [...rows].sort((a, b) => {
    if (a.level !== b.level) return a.level - b.level;
    const reasonDelta = (IMPACT_REASON_RANK[a.reason] ?? IMPACT_REASON_RANK.__fallback)
      - (IMPACT_REASON_RANK[b.reason] ?? IMPACT_REASON_RANK.__fallback);
    if (reasonDelta !== 0) return reasonDelta;
    const dirDelta = (dirOf(relPosix(a.file)) === inputDir ? 0 : 1)
      - (dirOf(relPosix(b.file)) === inputDir ? 0 : 1);
    if (dirDelta !== 0) return dirDelta;
    if (a.file === b.file) return 0;
    return a.file < b.file ? -1 : 1;
  });
}

async function impact(args, container, filePath) {
  if (args?.direction != null && !IMPACT_DIRECTIONS.has(args.direction)) {
    return failure('validation_error', `Invalid direction: ${args.direction}. Expected one of: ${[...IMPACT_DIRECTIONS].join(', ')}`);
  }
  const impact = container.snapshot.graph.getImpactRadius(filePath, args?.maxDepth, {
    direction: args?.direction,
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

  // Wave 12-1/12-5: honest truncation. T1.3: rows are relevance-ranked first
  // (closest + most-direct edges keep the slots), then --max-files overrides
  // the default relevance cap so users can explicitly request a tighter bound.
  const rankedImpact = rankImpactRows(impact, container.workspaceRoot, filePath);
  const impactLimit = Number.isFinite(args?.maxFiles) ? args.maxFiles : DEFAULTS.IMPACT_RELEVANCE_LIMIT;
  const impactTrunc = truncateArray(rankedImpact, impactLimit);
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
