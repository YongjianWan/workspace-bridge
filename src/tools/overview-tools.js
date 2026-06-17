/**
 * overview-tools.js - L4 薄编排层
 * 数据组装委托给 overview-assembler，文件 I/O 与渲染委托给 dashboard-formatter。
 */
const { DEFAULTS, SCORING } = require('../config/constants');
const { computeConfigHash } = require('../utils/project-context');
const { getFileHistoryRisk } = require('./git-tools');
const {
  assembleOverviewData,
  precomputeHotspotsAndStability,
  buildLanguageSupportMatrix,
} = require('./overview-assembler');
const {
  writeOverviewOutputs,
} = require('../cli/formatters/dashboard-formatter');
const { applyBaselineOperations } = require('./regression-tools');

function isSnapshotFresh(snapshot, container, args) {
  if (args?.hotspotData || args?.stabilityTrendData || args?.overviewDashboard) {
    return false;
  }
  const currentHead = container.cache?.getWorkspaceInfo?.()?.gitHead || '';
  const currentFileCount =
    container.snapshot?.graph?.getScopeSummary?.()?.counts?.totalFiles ||
    container.snapshot?.graph?.getAllFilePaths?.().length ||
    0;
  const headMatch = !currentHead || !snapshot.version || snapshot.version === currentHead;
  const countMatch = !currentFileCount || !snapshot.fileCount || snapshot.fileCount === currentFileCount;
  const fileChanges = container.cache?.checkFileChanges?.();
  const noContentChanges = !fileChanges || !fileChanges.changed;

  const currentConfig = container.projectContext?.config || null;
  const currentConfigHash = computeConfigHash(currentConfig);
  const snapshotConfigHash = snapshot.configHash ?? '';
  const configMatch = snapshotConfigHash === currentConfigHash;

  const snapshotData = snapshot.data;
  const historyMatch = !args?.withHistory || (snapshotData?.knowledgeRisk && !snapshotData.knowledgeRisk.disabled);

  return headMatch && countMatch && noContentChanges && configMatch && historyMatch;
}

async function buildProjectOverview(args, container) {
  await container.ensureReady();

  try {
    const snapshot = container.cache?.loadAnalysisSnapshot?.('overview');
    if (snapshot && isSnapshotFresh(snapshot, container, args)) {
      const cloned = JSON.parse(JSON.stringify(snapshot.data));
      applyBaselineOperations(cloned, args);
      return cloned;
    }
  } catch (_) {
    // Snapshot load failed or was corrupted; fall back to recompute
  }

  // History/blame is opt-in: default audit-overview/summary should not pay the
  // cost of per-file git log/blame. Explicit historyProvider is preserved for
  // backward compatibility and tests.
  const historyProvider = args?.historyProvider
    ? args.historyProvider
    : (args?.withHistory ? getFileHistoryRisk : null);
  const rawData = await assembleOverviewData(args, container, historyProvider);
  if (!rawData.ok) return rawData;

  const ioResults = await writeOverviewOutputs(args, rawData);

  const options = {};
  if (args?.hotspotData) options.hotspotData = { enabled: true, path: args.hotspotData };
  if (args?.stabilityTrendData) options.stabilityTrendData = { enabled: true, path: args.stabilityTrendData, granularity: rawData.trendGranularity };
  if (args?.overviewDashboard) options.overviewDashboard = { enabled: true, path: args.overviewDashboard };

  const result = {
    ok: true,
    workspaceRoot: rawData.root,
    stackProfile: rawData.stackProfile,
    options,
    summary: rawData.summary,
    scope: rawData.scope,
    aggregates: rawData.aggregates,
    skeleton: rawData.skeleton,
    hotspots: rawData.hotspots.slice(0, SCORING.TOP_N_LIST),
    architectureAdvice: {
      cycleRefactorSuggestions: rawData.cycleRefactorSuggestions,
      couplingSplitSuggestions: rawData.mainlineFiles.length < DEFAULTS.SMALL_PROJECT_MAX_MAINLINE ? [] : rawData.couplingSplitSuggestions,
    },
    hotspotData: ioResults.hotspotData,
    hotspotDataFile: ioResults.hotspotDataFile || null,
    stabilityTrend: ioResults.stabilityTrend,
    stabilityTrendDataFile: ioResults.stabilityTrendDataFile || null,
    overviewDashboardFile: ioResults.overviewDashboardFile || null,
    stability: rawData.stability.slice(0, SCORING.TOP_N_LIST),
    stabilityMeta: {
      totalCount: rawData.stability.length,
      truncated: rawData.stability.length > SCORING.TOP_N_LIST,
      limit: SCORING.TOP_N_LIST,
    },
    knowledgeRisk: rawData.knowledgeRisk,
    knowledgeRiskMeta: {
      totalCount: rawData.knowledgeRisk?.filesAnalyzed || 0,
      highCount: rawData.knowledgeRisk?.high?.length || 0,
      mediumCount: rawData.knowledgeRisk?.medium?.length || 0,
      lowCount: rawData.knowledgeRisk?.low?.length || 0,
      disabledReason: rawData.knowledgeRisk?.disabledReason || null,
    },
    languageSupport: buildLanguageSupportMatrix(rawData.depGraph),
    ...(rawData.scope ? { directoryRoles: rawData.scope.directoryRoles } : {}),
    ...(rawData.analysisCoverage ? { analysisCoverage: rawData.analysisCoverage } : {}),
    deadExports: rawData.deadExports,
    unresolved: rawData.unresolved,
    cycles: rawData.cycles,
    astRules: rawData.astRules,
    orphans: {
      counts: {
        docs: rawData.orphans.docs.length,
        scripts: rawData.orphans.scripts.length,
        configs: rawData.orphans.configs.length,
        modules: rawData.orphans.modules.length,
        total: rawData.orphanCount,
      },
      samples: {
        docs: rawData.orphans.docs.slice(0, 5),
        scripts: rawData.orphans.scripts.slice(0, 5),
        configs: rawData.orphans.configs.slice(0, 5),
        modules: rawData.orphans.modules.slice(0, 5),
      },
    },
  };

  const { checkBoundaries } = require('./dep-tools/boundaries');
  const { checkSmells } = require('./dep-tools/smells');
  const { parseCategories } = require('./audit-assembler');

  const categories = parseCategories(args?.category);
  const shouldRunBoundaries = !categories || categories.includes('boundaries');
  const shouldRunSmells = !categories || categories.includes('smells');

  // Deep checks can be expensive on large repos; gate by mainline file count
  const mainlineCount = rawData.mainlineFiles?.length || 0;
  const shouldRunDeepChecks = mainlineCount <= DEFAULTS.SMALL_PROJECT_MAX_MAINLINE;
  const boundariesResult = (shouldRunDeepChecks && shouldRunBoundaries) ? checkBoundaries(args, container) : { ok: true, violationsCount: 0, rulesApplied: [], violations: [], omitted: !shouldRunBoundaries };
  const smellsResult = (shouldRunDeepChecks && shouldRunSmells) ? checkSmells(args, container) : { ok: true, smellsCount: 0, smells: [], omitted: !shouldRunSmells };

  result.boundaries = {
    ok: true,
    violationsCount: boundariesResult.violationsCount,
    rulesAppliedCount: boundariesResult.rulesApplied?.length || 0,
    violations: boundariesResult.violations,
    ...(boundariesResult.omitted ? { omitted: true } : {}),
  };
  result.smells = {
    ok: true,
    smellsCount: smellsResult.smellsCount,
    smells: smellsResult.smells,
    ...(smellsResult.omitted ? { omitted: true } : {}),
  };

  if (result.summary) {
    if (!result.summary.counts) result.summary.counts = {};
    if (!boundariesResult.omitted) {
      result.summary.counts.boundaries = boundariesResult.violationsCount;
      if (boundariesResult.violationsCount > 0) {
        result.summary.recommendations.push(`Found ${boundariesResult.violationsCount} architecture boundary violations. Run node cli.js audit-boundaries for details.`);
      }
    }
    if (!smellsResult.omitted) {
      result.summary.counts.smells = smellsResult.smellsCount;
      if (smellsResult.smellsCount > 0) {
        result.summary.recommendations.push(`Found ${smellsResult.smellsCount} code smell issues. Run node cli.js audit-smells for details.`);
      }
    }
    if (rawData.astRules && !rawData.astRules.omitted) {
      result.summary.counts.astRules = rawData.astRules.findingsCount;
      if (rawData.astRules.findingsCount > 0) {
        result.summary.recommendations.push(`Found ${rawData.astRules.findingsCount} AST rule findings. Run node cli.js audit-overview for details.`);
      }
    }
  }

  applyBaselineOperations(result, args);

  // Stage 3.5: Persist aggregate snapshot for query-* commands
  try {
    const gitHead = container.cache?.getWorkspaceInfo?.()?.gitHead || '';
    const fileCount = result.scope?.counts?.totalFiles || 0;
    const configHash = computeConfigHash(container.projectContext?.config || null);

    // Save to the new analysis_snapshots table
    container.cache?.saveAnalysisSnapshot?.('overview', result, gitHead, fileCount, configHash);

    // Keep writing to precomputed_aggregates for backwards-compatibility
    const snapshotPayload = {
      hotspots: result.hotspots,
      knowledgeRisk: result.knowledgeRisk,
      stability: result.stability,
      languageSupport: result.languageSupport,
      deadExports: result.deadExports,
      unresolved: result.unresolved,
      cycles: result.cycles,
      orphans: result.orphans,
      aggregates: result.aggregates,
      summary: result.summary,
    };
    container.cache?.savePrecomputedAggregates?.([
      { key: 'analysis_snapshot', data: JSON.stringify(snapshotPayload), version: gitHead, fileCount, configHash },
    ]);
  } catch (_) {
    // Snapshot persistence is best-effort; never block the main flow
  }

  return result;
}

module.exports = {
  buildProjectOverview,
  precomputeHotspotsAndStability,
};
