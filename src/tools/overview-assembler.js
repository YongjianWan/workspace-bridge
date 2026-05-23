/**
 * overview-assembler.js - L4 数据组装层
 * 纯数据转换、聚合与计算，零 I/O 副作用。
 */
const path = require('path');
const { toRelativePosix } = require('../utils/path');
const { findOrphanFiles } = require('../utils/orphan-detector');
const { detectStack } = require('../utils/stack-detectors/detect');
const { DEFAULTS, SCORING, LIMITS } = require('../config/constants');
const { getFileHistoryRisk } = require('./git-tools');
const {
  buildOverviewSummary,
  buildCycleRefactorSuggestions,
  buildCouplingSplitSuggestions,
  calculateCoupling,
} = require('./overview-curator');
const {
  classifyUnresolved,
  classifyDeadExports,
  buildClassificationSummary,
} = require('./honesty-engine');

function toRelative(root, filePath) {
  return toRelativePosix(root, filePath);
}

const HOTSPOT_SCORE_RULES = [
  { field: 'commitCount', alt: 'churn', cap: SCORING.HOTSPOT_COMMIT_COUNT_CAP, weight: SCORING.HOTSPOT_COMMIT_COUNT_WEIGHT },
  { field: 'authorCount', fallback: SCORING.HOTSPOT_AUTHOR_COUNT_FALLBACK, weight: SCORING.HOTSPOT_AUTHOR_COUNT_WEIGHT },
  { field: 'lastModifiedDaysAgo', condition: (v) => v !== undefined && v !== null, transform: (v) => Math.max(0, SCORING.HOTSPOT_LAST_MODIFIED_DAYS_CAP - v) * SCORING.HOTSPOT_LAST_MODIFIED_DAYS_MULTIPLIER },
  { field: 'revertLikeCount', fallback: SCORING.HOTSPOT_REVERT_COUNT_FALLBACK, weight: SCORING.HOTSPOT_REVERT_COUNT_WEIGHT },
];

function calculateHotspotScore(historyRisk, fileRole, entryPointWeight, pageRank = 0, totalFiles = 0) {
  if (!historyRisk && pageRank === 0) return 0;

  let score = 0;
  for (const rule of HOTSPOT_SCORE_RULES) {
    let value = historyRisk?.[rule.field];
    if (value === undefined && rule.alt) value = historyRisk?.[rule.alt];
    if (value === undefined || value === null) value = rule.fallback || 0;
    if (rule.condition && !rule.condition(value)) continue;
    if (rule.cap !== undefined) value = Math.min(value, rule.cap);
    if (rule.transform) {
      score += rule.transform(value);
    } else {
      score += value * rule.weight;
    }
  }
  if (fileRole === 'config') {
    score = Math.floor(score * SCORING.HOTSPOT_CONFIG_DISCOUNT);
  }
  if (entryPointWeight > 1) {
    score = Math.floor(score * entryPointWeight);
  }
  if (totalFiles > 0 && pageRank > 0) {
    const averageRank = 1.0 / totalFiles;
    if (pageRank > averageRank * 2) {
      score = Math.floor(score * SCORING.HOTSPOT_PAGERANK_BOOST);
    }
    if ((!historyRisk || historyRisk.commitCount === 0) && score === 0) {
      score = Math.min(Math.round(pageRank * SCORING.HOTSPOT_SCORE_MAX), SCORING.HOTSPOT_SCORE_MAX);
    }
  }
  return Math.min(Math.round(score), SCORING.HOTSPOT_SCORE_MAX);
}

const STABILITY_SCORE_RULES = [
  { check: (ctx) => ctx.hasTests, delta: SCORING.STABILITY_HAS_TESTS_DELTA },
  { check: (ctx) => ctx.impactCount < 5, delta: SCORING.STABILITY_LOW_IMPACT_DELTA },
  { check: (ctx) => ctx.impactCount > 20, delta: SCORING.STABILITY_HIGH_IMPACT_DELTA },
  { check: (ctx) => !ctx.classification?.isMainline, delta: SCORING.STABILITY_NON_MAINLINE_DELTA },
  { check: (ctx) => ctx.inCycle, delta: SCORING.STABILITY_IN_CYCLE_DELTA },
  { check: (ctx) => ctx.classification?.fileRole === 'config', delta: SCORING.STABILITY_CONFIG_ROLE_DELTA },
];

function calculateStabilityScore(classification, impactCount, hasTests, inCycle) {
  let score = SCORING.STABILITY_BASE_SCORE;
  const ctx = { classification, impactCount, hasTests, inCycle };
  for (const rule of STABILITY_SCORE_RULES) {
    if (rule.check(ctx)) score += rule.delta;
  }
  return Math.max(SCORING.STABILITY_SCORE_MIN, Math.min(SCORING.STABILITY_SCORE_MAX, score));
}

function identifyCoreModules(graph, files, projectContext, root) {
  const candidates = [];

  for (const file of files) {
    const classification = projectContext?.classifyFile?.(file);
    if (!classification?.isMainline) continue;
    const dependents = graph.getDependents?.(file) || [];
    if (dependents.length >= SCORING.CORE_MODULE_MIN_DEPENDENTS && classification.fileRole === 'library') {
      candidates.push({
        file: toRelative(root, file),
        dependentsCount: dependents.length,
        reason: `被 ${dependents.length} 个模块依赖`,
      });
    }
  }

  return candidates.sort((a, b) => b.dependentsCount - a.dependentsCount).slice(0, SCORING.TOP_N_LIST);
}

async function getHistoryRisk(root, filePath, historyProvider) {
  try {
    const result = await historyProvider(root, filePath, { limit: DEFAULTS.HISTORY_LIMIT });
    if (result?.ok === false) return null;
    return result?.historyRisk || null;
  } catch (e) {
    console.error(`[overview] Failed to get history for ${filePath}:`, e.message);
    return null;
  }
}

function buildSkeleton(root, depGraph, allFiles, mainlineFiles, projectContext, entryFiles) {
  return {
    entryPoints: entryFiles || [],
    totalFiles: allFiles.length,
    mainlineFiles: mainlineFiles.length,
    testFiles: allFiles.filter((f) => depGraph.isTestLikeFile(f)).length,
    coreModules: identifyCoreModules(depGraph, allFiles, projectContext, root),
  };
}

async function buildHotspots(root, depGraph, mainlineFiles, historyProvider) {
  const files = mainlineFiles.slice(0, DEFAULTS.HOTSPOT_CANDIDATE_LIMIT);
  const concurrency = LIMITS.GIT_LOG_CONCURRENCY;
  const candidates = [];

  for (let i = 0; i < files.length; i += concurrency) {
    const batch = files.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (file) => {
        const displayFile = depGraph._displayPath?.(file) || file;
        const relativePath = toRelative(root, displayFile);
        const dependents = depGraph.getDependents?.(file) || [];
        const dependencies = depGraph.getDependencies?.(file) || [];
        const historyRisk = await getHistoryRisk(root, displayFile, historyProvider);
        const classification = depGraph.projectContext?.classifyFile?.(displayFile);
        const fileRole = classification?.fileRole;
        const frameworkHint = depGraph.getFrameworkHint?.(file);
        const pageRank = depGraph.getPageRank?.(file) || 0;
        const score = calculateHotspotScore(historyRisk, fileRole, frameworkHint?.entryPointWeight, pageRank, depGraph.graph?.size || 0);
        const coupling = calculateCoupling(dependencies, dependents);
        if (score <= SCORING.HOTSPOT_REPORT_THRESHOLD && coupling.total <= SCORING.COUPLING_MEDIUM_MIN) return null;
        const historySignal = historyRisk?.signals?.[0];
        const couplingSignal = coupling.total > 0 ? `${coupling.total} 个依赖连接` : null;
        let reason;
        if (historySignal && couplingSignal) {
          reason = `耦合 ${coupling.total} 个模块 · ${historySignal}`;
        } else if (historySignal) {
          reason = historySignal;
        } else if (couplingSignal) {
          reason = couplingSignal;
        } else {
          reason = '高风险文件';
        }
        return {
          file: relativePath,
          score,
          risk: historyRisk?.level || 'low',
          coupling: coupling.total,
          reason,
        };
      })
    );
    candidates.push(...batchResults);
  }

  return candidates.filter(Boolean).sort((a, b) => b.score - a.score);
}

function buildStability(root, depGraph, mainlineFiles, projectContext) {
  const stability = [];
  const allCycles = depGraph.findCircularDependencies?.() || [];
  const filesInCycle = new Set(allCycles.flat());

  for (const file of mainlineFiles) {
    const displayFile = depGraph._displayPath?.(file) || file;
    const relativePath = toRelative(root, displayFile);
    const classification = projectContext.classifyFile(displayFile);
    const dependents = depGraph.getDependents?.(file) || [];
    const dependencies = depGraph.getDependencies?.(file) || [];
    const hasTests = dependents.some((d) => depGraph.isTestLikeFile(d));
    const inCycle = filesInCycle.has(file);
    const score = calculateStabilityScore(classification, dependents.length, hasTests, inCycle);
    const coupling = calculateCoupling(dependencies, dependents);
    stability.push({
      file: relativePath,
      stabilityScore: score,
      coupling,
      hasTests,
      inCycle,
      assessment: score >= SCORING.STABILITY_STABLE_THRESHOLD ? 'stable' : score >= SCORING.STABILITY_FRAGILE_THRESHOLD ? 'moderate' : 'fragile',
    });
  }

  return stability.sort((a, b) => a.stabilityScore - b.stabilityScore);
}

function aggregateOverviewStats(hotspots, stability) {
  const hotspotsByRisk = { high: 0, medium: 0, low: 0 };
  for (const item of hotspots) {
    const level = item?.risk || 'low';
    if (hotspotsByRisk[level] === undefined) hotspotsByRisk[level] = 0;
    hotspotsByRisk[level] += 1;
  }

  const stabilityCounts = { stable: 0, moderate: 0, fragile: 0 };
  for (const item of stability) {
    const assessment = item?.assessment || 'moderate';
    if (stabilityCounts[assessment] === undefined) stabilityCounts[assessment] = 0;
    stabilityCounts[assessment] += 1;
  }

  return { hotspotsByRisk, stabilityCounts };
}

function buildHotspotVisualizationData(root, hotspots, aggregates) {
  const ranked = hotspots
    .slice()
    .sort((a, b) => (b?.score || 0) - (a?.score || 0))
    .map((item, index) => ({
      id: item.file,
      file: item.file,
      rank: index + 1,
      score: item.score || 0,
      risk: item.risk || 'low',
      coupling: item.coupling || 0,
      reason: item.reason || '',
    }));

  return {
    schemaVersion: '1.2.0',
    generatedAt: new Date().toISOString(),
    workspaceRoot: root,
    stats: {
      hotspotCount: ranked.length,
      byRisk: aggregates?.hotspotsByRisk || { high: 0, medium: 0, low: 0 },
      maxScore: ranked[0]?.score || 0,
    },
    hotspots: ranked,
  };
}

function toDayKey(isoTimestamp) {
  return String(isoTimestamp).slice(0, 10);
}

function toWeekKey(isoTimestamp) {
  const d = new Date(isoTimestamp);
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function getTrendBucketKey(isoTimestamp, granularity) {
  return granularity === 'week' ? toWeekKey(isoTimestamp) : toDayKey(isoTimestamp);
}

function buildStabilityTrendSnapshot(isoTimestamp, stability, aggregates) {
  const rows = Array.isArray(stability) ? stability : [];
  const total = rows.reduce((sum, item) => sum + (Number(item?.stabilityScore) || 0), 0);
  const stabilityScore = rows.length > 0 ? Math.round((total / rows.length) * 100) / 100 : 0;
  return {
    timestamp: isoTimestamp,
    stabilityScore,
    fragileCount: Number(aggregates?.stabilityCounts?.fragile) || 0,
    hotspotsByRisk: {
      high: Number(aggregates?.hotspotsByRisk?.high) || 0,
      medium: Number(aggregates?.hotspotsByRisk?.medium) || 0,
      low: Number(aggregates?.hotspotsByRisk?.low) || 0,
    },
  };
}

function buildStabilityTrendSeries(history, granularity) {
  const rows = Array.isArray(history) ? history : [];
  const buckets = new Map();
  for (const row of rows) {
    if (!row?.timestamp) continue;
    const bucket = getTrendBucketKey(row.timestamp, granularity);
    const existing = buckets.get(bucket);
    if (!existing || String(row.timestamp) > String(existing.timestamp)) {
      buckets.set(bucket, { ...row, bucket });
    }
  }

  return Array.from(buckets.values())
    .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)))
    .map((item) => ({
      bucket: item.bucket,
      timestamp: item.timestamp,
      stabilityScore: item.stabilityScore,
      fragileCount: item.fragileCount,
      hotspotsByRisk: item.hotspotsByRisk,
    }));
}

const EXT_TO_LANG = {
  '.js': 'javascript', '.jsx': 'javascript', '.ts': 'javascript', '.tsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.py': 'python',
  '.java': 'java',
  '.kt': 'kotlin',
  '.go': 'go',
  '.rs': 'rust',
};

function buildLanguageSupportMatrix(depGraph) {
  const matrix = {};
  const stats = {};
  for (const [filePath, info] of depGraph.graph || []) {
    const lang = EXT_TO_LANG[path.extname(filePath).toLowerCase()];
    if (!lang) continue;
    if (!stats[lang]) stats[lang] = { total: 0, ast: 0, regex: 0, fallbackReasons: {} };
    stats[lang].total++;
    if (info.parseMode === 'ast') {
      stats[lang].ast++;
    } else {
      stats[lang].regex++;
      const reason = info.parseModeReason || 'unknown';
      stats[lang].fallbackReasons[reason] = (stats[lang].fallbackReasons[reason] || 0) + 1;
    }
  }
  for (const [lang, s] of Object.entries(stats)) {
    const ratio = s.total > 0 ? s.ast / s.total : 0;
    matrix[lang] = {
      level: ratio >= 0.5 ? 'ast' : 'regex',
      confidence: ratio >= 0.8 ? 'high' : ratio >= 0.5 ? 'medium' : 'low',
      files: s.total,
      astFiles: s.ast,
      regexFiles: s.regex,
      fallbackReasons: s.fallbackReasons,
    };
  }
  return matrix;
}

async function precomputeHotspotsAndStability(depGraph) {
  const root = depGraph.root;
  const projectContext = depGraph.projectContext;
  if (!projectContext) return { hotspots: null, stability: null };

  const shouldExcludeCli = depGraph.shouldExcludeCli?.bind(depGraph);
  const allFiles = Array.from(depGraph.graph?.keys() || []).filter((f) => !shouldExcludeCli || !shouldExcludeCli(f));
  const mainlineFiles = allFiles.filter((f) => {
    const c = projectContext.classifyFile(f);
    return c.isMainline && c.fileRole !== 'test' && c.fileRole !== 'docs' && c.fileRole !== 'style' && c.fileRole !== 'asset';
  });

  const hotspots = await buildHotspots(root, depGraph, mainlineFiles, getFileHistoryRisk);
  const stability = buildStability(root, depGraph, mainlineFiles, projectContext);
  return { hotspots, stability };
}

async function assembleOverviewData(args, container, historyProvider) {
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
    summary.recommendations.unshift(`WARNING: Analysis coverage is low (${Math.round(analysisCoverage.coverageRatio * 100)}%); findings may be incomplete.`);
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
    trendGranularity,
  };
}

module.exports = {
  assembleOverviewData,
  precomputeHotspotsAndStability,
  buildHotspotVisualizationData,
  buildStabilityTrendSnapshot,
  buildStabilityTrendSeries,
  buildLanguageSupportMatrix,
  buildHotspots,
  buildStability,
  buildSkeleton,
  aggregateOverviewStats,
  calculateHotspotScore,
  calculateStabilityScore,
  identifyCoreModules,
  getHistoryRisk,
  toDayKey,
  toWeekKey,
  getTrendBucketKey,
};
