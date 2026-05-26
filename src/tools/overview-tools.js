/**
 * overview-tools.js - L4 薄编排层
 * 数据组装委托给 overview-assembler，文件 I/O 与渲染委托给 dashboard-formatter。
 */
const { DEFAULTS, SCORING } = require('../config/constants');
const { getFileHistoryRisk } = require('./git-tools');
const {
  assembleOverviewData,
  precomputeHotspotsAndStability,
  buildLanguageSupportMatrix,
} = require('./overview-assembler');
const {
  writeOverviewOutputs,
} = require('../cli/formatters/dashboard-formatter');

async function buildProjectOverview(args, container) {
  await container.ensureReady();
  const historyProvider = args?.historyProvider || getFileHistoryRisk;
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
    },
    languageSupport: buildLanguageSupportMatrix(rawData.depGraph),
    ...(rawData.scope ? { directoryRoles: rawData.scope.directoryRoles } : {}),
    ...(rawData.analysisCoverage ? { analysisCoverage: rawData.analysisCoverage } : {}),
    deadExports: rawData.deadExports,
    unresolved: rawData.unresolved,
    cycles: rawData.cycles,
    orphans: {
      counts: {
        docs: rawData.orphans.docs.length,
        scripts: rawData.orphans.scripts.length,
        counts: 0, // Unused / kept for placeholder
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

  if (args?.save) {
    const fs = require('fs');
    const path = require('path');
    const regressionTools = require('./regression-tools');
    const saveFilename = typeof args.save === 'string' ? args.save : regressionTools.DEFAULT_BASELINE_FILE;
    const savePath = path.resolve(args.cwd || process.cwd(), saveFilename);
    regressionTools.saveBaseline(result, savePath);
    result.baselineSaved = savePath;
  }

  if (args?.checkRegression) {
    const fs = require('fs');
    const path = require('path');
    const regressionTools = require('./regression-tools');
    let baselinePath = null;
    let commitBaseline = null;
    if (args.baseline && typeof args.baseline === 'string') {
      const resolved = path.resolve(args.cwd || process.cwd(), args.baseline);
      if (fs.existsSync(resolved)) {
        baselinePath = resolved;
      } else {
        commitBaseline = args.baseline;
      }
    } else {
      baselinePath = path.resolve(args.cwd || process.cwd(), regressionTools.DEFAULT_BASELINE_FILE);
    }
    if (commitBaseline) {
      const regResult = regressionTools.checkRegressionAgainstCommit(result, commitBaseline, args.cwd || process.cwd());
      result.regression = { ...regResult.regression, commit: regResult.commit };
    } else {
      const regResult = regressionTools.checkRegression(result, baselinePath);
      result.regression = { ...regResult.regression, baselinePath: regResult.baselinePath, baselineTimestamp: regResult.baselineTimestamp };
    }
  }

  // Stage 3.5: Persist aggregate snapshot for query-* commands
  try {
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
    const gitHead = container.cache?.getWorkspaceInfo?.()?.gitHead || '';
    const fileCount = result.scope?.counts?.totalFiles || 0;
    container.cache?.savePrecomputedAggregates?.([
      { key: 'analysis_snapshot', data: JSON.stringify(snapshotPayload), version: gitHead, fileCount },
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
