const fs = require('fs');
const path = require('path');
const targetPath = path.join(__dirname, '../src/tools/overview-tools.js');
const content = fs.readFileSync(targetPath, 'utf8');

const startIndex = content.indexOf('async function buildProjectOverview(args, container) {');
const endIndex = content.indexOf('module.exports = {');

if (startIndex === -1 || endIndex === -1) {
  console.error("Could not find boundaries");
  process.exit(1);
}

const before = content.substring(0, startIndex);
const after = content.substring(endIndex);

const newCode = `async function assembleOverviewData(args, container, historyProvider) {
  const root = container.workspaceRoot;
  const depGraph = container.depGraph;
  const projectContext = depGraph?.projectContext;

  if (!depGraph || !projectContext) {
    return { ok: false, error: 'Dependency graph not initialized' };
  }

  const shouldExcludeCli = depGraph.shouldExcludeCli?.bind(depGraph);
  const allFiles = Array.from(depGraph.graph?.keys() || []).filter((f) => !shouldExcludeCli || !shouldExcludeCli(f));
  const mainlineFiles = allFiles.filter((f) => {
    const c = projectContext.classifyFile(f);
    return c.isMainline && c.fileRole !== 'test' && c.fileRole !== 'docs' && c.fileRole !== 'style' && c.fileRole !== 'asset';
  });
  let scope = null;
  let entryFiles = [];
  if (typeof projectContext.summarizeFiles === 'function') {
    scope = projectContext.summarizeFiles(allFiles, (file) => depGraph.getDependents(file).length > 0);
    entryFiles = scope.entryFiles || [];
  }
  const skeleton = buildSkeleton(root, depGraph, allFiles, mainlineFiles, projectContext, entryFiles);

  const aggregate = depGraph.analyzer?._aggregateCache;
  const hasValidAggregate = aggregate && aggregate.version === depGraph.analyzer?._aggregateVersion;
  let hotspots = (hasValidAggregate && aggregate?.hotspots) ? aggregate.hotspots : null;
  let stability = (hasValidAggregate && aggregate?.stability) ? aggregate.stability : null;

  if ((!hotspots || !stability) && container.ensurePrecomputed) {
    await container.ensurePrecomputed(['overview']);
    const refreshed = depGraph.analyzer?._aggregateCache;
    const refreshedValid = refreshed && refreshed.version === depGraph.analyzer?._aggregateVersion;
    hotspots = (refreshedValid && refreshed.hotspots) ? refreshed.hotspots : hotspots;
    stability = (refreshedValid && refreshed.stability) ? refreshed.stability : stability;
  }

  hotspots = hotspots || await buildHotspots(root, depGraph, mainlineFiles, historyProvider);
  stability = stability || buildStability(root, depGraph, mainlineFiles, projectContext);
  const orphans = findOrphanFiles(allFiles, depGraph.entryFiles, depGraph, root, null, depGraph.isKnownEntryFile?.bind(depGraph), depGraph.shouldExcludeCli?.bind(depGraph));
  const unresolved = depGraph.findUnresolvedImports?.() || [];
  const cycles = depGraph.findCircularDependencies?.() || [];
  const deadExports = depGraph.findDeadExports?.() || [];
  const stack = detectStack(root);
  const stackProfile = stack.profile;

  let unresolvedFp = null;
  if (unresolved.length > 0) {
    const classifications = classifyUnresolved(unresolved, root);
    const summary = buildClassificationSummary(classifications);
    unresolvedFp = { count: summary.falsePositiveCount, total: summary.total, primaryReason: summary.primaryReason };
  }

  let deadExportsFp = null;
  if (deadExports.length > 0) {
    const classifications = classifyDeadExports(deadExports, depGraph);
    const summary = buildClassificationSummary(classifications);
    deadExportsFp = { count: summary.falsePositiveCount, total: summary.total, primaryReason: summary.primaryReason };
  }

  const issueContext = {
    unresolved: { count: unresolved.length, fp: unresolvedFp },
    cycles: { count: cycles.length },
    deadExports: { count: deadExports.length, fp: deadExportsFp },
  };
  const cycleRefactorSuggestions = buildCycleRefactorSuggestions(root, depGraph, projectContext);
  const couplingSplitSuggestions = buildCouplingSplitSuggestions(root, depGraph, mainlineFiles, projectContext);
  const { summary, orphanCount } = buildOverviewSummary(hotspots, stability, orphans, issueContext, stackProfile, stack, cycleRefactorSuggestions, couplingSplitSuggestions);
  const aggregates = aggregateOverviewStats(hotspots, stability);

  const dgStats = depGraph.getStats?.() || {};
  const analysisCoverage = dgStats.analysisCoverage;
  if (analysisCoverage && analysisCoverage.coverageRatio < 0.5) {
    summary.severity = 'high';
    summary.recommendations.unshift(\`WARNING: Analysis coverage is low (\${Math.round(analysisCoverage.coverageRatio * 100)}%); findings may be incomplete.\`);
  }

  summary.counts = {
    deadExports: deadExports.length,
    unresolved: unresolved.length,
    cycles: cycles.length,
    missingHygieneChecks: 0,
  };
  if (analysisCoverage) summary.analysisCoverage = analysisCoverage;

  const nowIso = args?.now || new Date().toISOString();
  const trendGranularity = args?.trendGranularity === 'week' ? 'week' : 'day';

  return {
    ok: true,
    root,
    depGraph,
    scope,
    stackProfile,
    summary,
    aggregates,
    skeleton,
    hotspots,
    stability,
    mainlineFiles,
    orphanCount,
    orphans,
    analysisCoverage,
    cycleRefactorSuggestions,
    couplingSplitSuggestions,
    nowIso,
    trendGranularity
  };
}

async function writeOverviewOutputs(args, rawData) {
  const { root, hotspots, aggregates, stability, nowIso, trendGranularity, mainlineFiles, cycleRefactorSuggestions, couplingSplitSuggestions, summary, skeleton } = rawData;
  const outputFiles = {};
  
  if (args?.hotspotData) {
    const target = path.isAbsolute(args.hotspotData) ? args.hotspotData : path.resolve(root, args.hotspotData);
    const hotspotData = buildHotspotVisualizationData(root, hotspots, aggregates);
    await writeHotspotDataFile(target, hotspotData);
    outputFiles.hotspotDataFile = target;
    outputFiles.hotspotData = hotspotData;
  } else {
    outputFiles.hotspotData = buildHotspotVisualizationData(root, hotspots, aggregates);
  }

  const stabilityTrendSnapshot = buildStabilityTrendSnapshot(nowIso, stability, aggregates);
  if (args?.stabilityTrendData) {
    const target = path.isAbsolute(args.stabilityTrendData) ? args.stabilityTrendData : path.resolve(root, args.stabilityTrendData);
    const existingHistory = await readTrendHistory(target);
    const history = [...existingHistory, stabilityTrendSnapshot];
    const series = buildStabilityTrendSeries(history, trendGranularity);
    const payload = {
      schemaVersion: '1.2.0',
      generatedAt: nowIso,
      workspaceRoot: root,
      granularity: trendGranularity,
      history,
      series,
    };
    await writeStabilityTrendFile(target, payload);
    outputFiles.stabilityTrendDataFile = target;
    outputFiles.stabilityTrend = { granularity: trendGranularity, latest: stabilityTrendSnapshot, series };
  } else {
    outputFiles.stabilityTrend = {
      granularity: trendGranularity,
      latest: stabilityTrendSnapshot,
      series: [stabilityTrendSnapshot].map((item) => ({
        bucket: getTrendBucketKey(item.timestamp, trendGranularity),
        timestamp: item.timestamp,
        stabilityScore: item.stabilityScore,
        fragileCount: item.fragileCount,
        hotspotsByRisk: item.hotspotsByRisk,
      })),
    };
  }

  if (args?.overviewDashboard) {
    const target = path.isAbsolute(args.overviewDashboard) ? args.overviewDashboard : path.resolve(root, args.overviewDashboard);
    const dashboardData = {
      workspaceRoot: root,
      summary,
      aggregates,
      skeleton,
      hotspots: hotspots.slice(0, SCORING.TOP_N_LIST),
      architectureAdvice: {
        cycleRefactorSuggestions,
        couplingSplitSuggestions: mainlineFiles.length < DEFAULTS.SMALL_PROJECT_MAX_MAINLINE ? [] : couplingSplitSuggestions,
      },
    };
    await writeOverviewDashboardFile(target, dashboardData);
    outputFiles.overviewDashboardFile = target;
  }

  return outputFiles;
}

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

  return {
    ok: true,
    workspaceRoot: rawData.root,
    stackProfile: rawData.stackProfile,
    options,
    summary: rawData.summary,
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
    languageSupport: buildLanguageSupportMatrix(rawData.depGraph),
    ...(rawData.scope ? { directoryRoles: rawData.scope.directoryRoles } : {}),
    ...(rawData.analysisCoverage ? { analysisCoverage: rawData.analysisCoverage } : {}),
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
}

`;

let finalContent = before + newCode + after.replace('module.exports = {', 'module.exports = {\n  assembleOverviewData,\n  writeOverviewOutputs,');
fs.writeFileSync(targetPath, finalContent, 'utf8');
console.log('Fixed U3 apply');
