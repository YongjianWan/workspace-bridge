/**
 * overview-tools.js - L4 薄编排层
 * 数据组装委托给 overview-assembler，文件 I/O 与渲染委托给 dashboard-formatter。
 */
const { DEFAULTS, SCORING } = require('../config/constants');
const { computeConfigHash } = require('../utils/project-context');
const { getFileHistoryRisk } = require('./git-tools');

function sliceArray(arr, limit) {
  if (!Array.isArray(arr) || arr.length <= limit) return arr;
  const truncated = arr.slice(0, limit);
  truncated.truncated = true;
  truncated.total = arr.length;
  return truncated;
}

function applyOutputLimits(result, args) {
  const maxFiles = args?.maxFiles && Number.isFinite(args.maxFiles) && args.maxFiles > 0 ? args.maxFiles : null;
  const compact = args?.compact;
  const limit = maxFiles || (compact ? DEFAULTS.COMPACT_ISSUE_MAX_ITEMS : null);
  if (!limit || limit <= 0) return;

  result.hotspots = sliceArray(result.hotspots, limit);
  result.stability = sliceArray(result.stability, limit);
  if (result.architectureAdvice) {
    result.architectureAdvice.cycleRefactorSuggestions = sliceArray(result.architectureAdvice.cycleRefactorSuggestions, limit);
    result.architectureAdvice.couplingSplitSuggestions = sliceArray(result.architectureAdvice.couplingSplitSuggestions, limit);
  }
  if (result.deadExports) result.deadExports.deadExports = sliceArray(result.deadExports.deadExports, limit);
  if (result.unresolved) result.unresolved.unresolved = sliceArray(result.unresolved.unresolved, limit);
  if (result.cycles) result.cycles.cycles = sliceArray(result.cycles.cycles, limit);
  if (result.astRules) result.astRules.findings = sliceArray(result.astRules.findings, limit);
  if (result.boundaries) result.boundaries.violations = sliceArray(result.boundaries.violations, limit);
  if (result.smells) result.smells.smells = sliceArray(result.smells.smells, limit);
  if (result.knowledgeRisk) {
    result.knowledgeRisk.high = sliceArray(result.knowledgeRisk.high, limit);
    result.knowledgeRisk.medium = sliceArray(result.knowledgeRisk.medium, limit);
    result.knowledgeRisk.low = sliceArray(result.knowledgeRisk.low, limit);
  }
  if (result.orphans?.samples) {
    for (const k of ['docs', 'scripts', 'configs', 'modules']) {
      result.orphans.samples[k] = sliceArray(result.orphans.samples[k], limit);
    }
  }

  // sliceArray marks truncation via array extra-props, which JSON.stringify
  // drops — under --json/--jsonl the signal would silently vanish (L1-4).
  // Mirror it into a plain object that survives serialization.
  const truncation = {};
  const collect = (label, arr) => {
    if (arr && arr.truncated) truncation[label] = { shown: arr.length, total: arr.total };
  };
  collect('hotspots', result.hotspots);
  collect('stability', result.stability);
  collect('cycleRefactorSuggestions', result.architectureAdvice?.cycleRefactorSuggestions);
  collect('couplingSplitSuggestions', result.architectureAdvice?.couplingSplitSuggestions);
  collect('deadExports', result.deadExports?.deadExports);
  collect('unresolved', result.unresolved?.unresolved);
  collect('cycles', result.cycles?.cycles);
  collect('astRulesFindings', result.astRules?.findings);
  collect('boundariesViolations', result.boundaries?.violations);
  collect('smells', result.smells?.smells);
  collect('knowledgeRiskHigh', result.knowledgeRisk?.high);
  collect('knowledgeRiskMedium', result.knowledgeRisk?.medium);
  collect('knowledgeRiskLow', result.knowledgeRisk?.low);
  if (Object.keys(truncation).length > 0) {
    result.outputTruncation = truncation;
  }
}
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
  const currentConfig = container.projectContext?.config || null;
  const currentConfigHash = computeConfigHash(currentConfig);
  const snapshotConfigHash = snapshot.configHash ?? '';
  const configMatch = snapshotConfigHash === currentConfigHash;

  const snapshotData = snapshot.data;
  const historyMatch = !args?.withHistory || (snapshotData?.knowledgeRisk && !snapshotData.knowledgeRisk.disabled);

  // Aggregate snapshots are intentionally coarse-grained: they stay fresh across
  // uncommitted file edits as long as the git commit, file count, and config
  // have not changed. This makes repeated `audit-overview` / `query-*` calls
  // near-instant on warm caches. Users who need real-time results after edits
  // can re-run with `--with-history` (which also refreshes the snapshot).
  return headMatch && countMatch && configMatch && historyMatch;
}

async function buildProjectOverview(args, container) {
  await container.ensureReady();

  // --category 过滤的运行必须双向绕过 'overview' 快照：
  // 1) 不读——快照存的是全量数据，直接返回会漏掉过滤语义；
  // 2) 不写——过滤后的子集一旦存成 'overview'，后续全量请求和 query-* 会
  //    静默消费残缺数据（快照 key 不含 category，无法区分）。
  const { parseCategories } = require('./audit-assembler');
  const requestedCategories = parseCategories(args?.category);

  if (!requestedCategories) {
    try {
      const snapshot = container.cache?.loadAnalysisSnapshot?.('overview');
      if (snapshot && isSnapshotFresh(snapshot, container, args)) {
        const cloned = JSON.parse(JSON.stringify(snapshot.data));
        applyBaselineOperations(cloned, args);
        applyOutputLimits(cloned, args);
        return cloned;
      }
    } catch (_) {
      // Snapshot load failed or was corrupted; fall back to recompute
    }
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
    droppedImports: rawData.droppedImports,
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

  const categories = requestedCategories;
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
  applyOutputLimits(result, args);

  // Stage 3.5: Persist aggregate snapshot for query-* commands
  // 仅全量运行可写快照；category / maxFiles / compact 过滤后的子集写入会毒化所有后续消费者
  if (requestedCategories || args?.maxFiles || args?.compact) return result;
  try {
    const gitHead = container.cache?.getWorkspaceInfo?.()?.gitHead || '';
    const fileCount = result.scope?.counts?.totalFiles || 0;
    const configHash = computeConfigHash(container.projectContext?.config || null);

    // analysis_snapshots is the ONLY home for the overview snapshot.
    // Never write it into precomputed_aggregates: that table is full-replace
    // (DELETE all + INSERT) and owned by savePrecomputed — a second writer
    // wipes the aggregate keys here and gets its own row wiped by the next
    // graph:built, so the "mirror" row was unreliable by construction.
    container.cache?.saveAnalysisSnapshot?.('overview', result, gitHead, fileCount, configHash);
  } catch (_) {
    // Snapshot persistence is best-effort; never block the main flow
  }

  return result;
}

module.exports = {
  buildProjectOverview,
  precomputeHotspotsAndStability,
};
