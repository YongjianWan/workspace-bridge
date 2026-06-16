/**
 * overview-assembler.js - L4 数据组装层
 * 纯数据转换、聚合与计算，零 I/O 副作用。
 */
const path = require('path');
const { toRelativePosix } = require('../utils/path');

const { detectStack } = require('../utils/stack-detectors/detect');
const { DATA_QUALITY } = require('../config/data-quality');
const { DEFAULTS, SCORING, LIMITS, SCHEMA_VERSION } = require('../config/constants');
const { getFileHistoryRisk, getFileKnowledgeRisk, getRepoEffectiveAuthorCount } = require('./git-tools');
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
  DEAD_EXPORT_FALSE_POSITIVE_REASONS,
} = require('./honesty-engine');
const { computePageRank } = require('../services/dep-graph/pagerank');

function toRelative(root, filePath) {
  return toRelativePosix(root, filePath);
}

function getArchitectureDependencies(depGraph, file) {
  return depGraph.getDependencies?.(file, { architectureOnly: true }) || [];
}

function getArchitectureDependents(depGraph, file) {
  return depGraph.getDependents?.(file, { architectureOnly: true }) || [];
}

function hasTestDependents(depGraph, file) {
  return depGraph.getDependents?.(file).some((d) => depGraph.isTestLikeFile(d)) || false;
}

function computeArchitecturalPageRank(depGraph) {
  const files = depGraph.getAllFilePaths?.() || [];
  const edges = [];
  for (const file of files) {
    if (depGraph.isTestLikeFile(file)) continue;
    for (const imp of getArchitectureDependencies(depGraph, file)) {
      edges.push([file, imp]);
    }
  }
  const productionFiles = files.filter((f) => !depGraph.isTestLikeFile(f));
  return computePageRank(productionFiles, edges);
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
    const dependents = graph.getDependents?.(file, { architectureOnly: true }) || [];
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

function buildEmptyKnowledgeRisk(disabledReason) {
  return {
    high: [],
    medium: [],
    low: [],
    filesAnalyzed: 0,
    disabled: true,
    disabledReason,
    dataQuality: DATA_QUALITY.UNAVAILABLE,
    remediation: null,
  };
}

async function buildKnowledgeRisk(root, mainlineFiles, gitEnvironment) {
  const repoAuthors = await getRepoEffectiveAuthorCount(root);
  if (!repoAuthors.ok || repoAuthors.count <= SCORING.KNOWLEDGE_RISK_PERSONAL_REPO_MAX_AUTHORS) {
    return buildEmptyKnowledgeRisk('too-few-authors');
  }

  const files = mainlineFiles.slice(0, DEFAULTS.HOTSPOT_CANDIDATE_LIMIT);
  const concurrency = LIMITS.GIT_LOG_CONCURRENCY;
  const results = [];

  for (let i = 0; i < files.length; i += concurrency) {
    const batch = files.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (file) => {
        try {
          const result = await getFileKnowledgeRisk(root, file);
          if (result?.ok === false) return null;
          return {
            file: result.file,
            totalLines: result.totalLines,
            authorCount: result.authorCount,
            primaryAuthor: result.primaryAuthor,
            primaryAuthorPct: result.primaryAuthorPct,
            riskLevel: result.riskLevel,
            reason: result.reason,
          };
        } catch {
          return null;
        }
      })
    );
    results.push(...batchResults);
  }

  const all = results.filter(Boolean);
  const high = all.filter((r) => r.riskLevel === 'high').sort((a, b) => b.primaryAuthorPct - a.primaryAuthorPct);
  const medium = all.filter((r) => r.riskLevel === 'medium').sort((a, b) => b.primaryAuthorPct - a.primaryAuthorPct);
  const low = all.filter((r) => r.riskLevel === 'low').sort((a, b) => b.primaryAuthorPct - a.primaryAuthorPct);

  const env = gitEnvironment || { dataQuality: DATA_QUALITY.CERTAIN, remediation: null };

  return {
    high,
    medium,
    low,
    filesAnalyzed: all.length,
    disabled: false,
    disabledReason: null,
    dataQuality: env.dataQuality,
    remediation: env.remediation,
  };
}

async function buildHotspots(root, depGraph, mainlineFiles, historyProvider) {
  const files = mainlineFiles.slice(0, DEFAULTS.HOTSPOT_CANDIDATE_LIMIT);
  const concurrency = LIMITS.GIT_LOG_CONCURRENCY;
  const candidates = [];
  const architecturalPageRanks = computeArchitecturalPageRank(depGraph);
  const totalFiles = depGraph.getFileCount?.() || 0;

  for (let i = 0; i < files.length; i += concurrency) {
    const batch = files.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (file) => {
        const displayFile = depGraph._displayPath?.(file) || file;
        const relativePath = toRelative(root, displayFile);
        const dependents = getArchitectureDependents(depGraph, file);
        const dependencies = getArchitectureDependencies(depGraph, file);
        const historyRisk = historyProvider ? await getHistoryRisk(root, displayFile, historyProvider) : null;
        const classification = depGraph.projectContext?.classifyFile?.(displayFile);
        const fileRole = classification?.fileRole;
        const frameworkHint = depGraph.getFrameworkHint?.(file);
        const pageRank = architecturalPageRanks.get(file) || 0;
        const score = calculateHotspotScore(historyRisk, fileRole, frameworkHint?.entryPointWeight, pageRank, totalFiles);
        const coupling = calculateCoupling(dependencies, dependents);
        if (score <= SCORING.HOTSPOT_REPORT_THRESHOLD && coupling.total <= SCORING.COUPLING_MEDIUM_MIN) return null;
        const historySignal = historyRisk?.signals?.[0];
        let couplingSignal = null;
        if (coupling.total > 0) {
          if (coupling.inDegree >= coupling.outDegree * 2) {
            couplingSignal = `耦合: 被 ${coupling.inDegree} 个模块依赖（高 fan-in）`;
          } else if (coupling.outDegree >= coupling.inDegree * 2) {
            couplingSignal = `耦合: 依赖 ${coupling.outDegree} 个模块（高 fan-out）`;
          } else {
            couplingSignal = `耦合: ${coupling.inDegree} 入 / ${coupling.outDegree} 出`;
          }
        }
        let reason;
        if (historySignal && couplingSignal) {
          reason = `${couplingSignal} · ${historySignal}`;
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
    const dependents = getArchitectureDependents(depGraph, file);
    const dependencies = getArchitectureDependencies(depGraph, file);
    const hasTests = hasTestDependents(depGraph, file);
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
    schemaVersion: SCHEMA_VERSION,
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
  for (const [filePath, info] of depGraph.getAllFileInfos?.() || []) {
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
  const allFiles = (depGraph.getAllFilePaths?.() || []).filter((f) => !shouldExcludeCli || !shouldExcludeCli(f));
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
  const depGraph = container.snapshot?.graph || container.depGraph;
  const projectContext = depGraph?.projectContext;

  if (!depGraph || !projectContext) {
    return { ok: false, error: 'Dependency graph not initialized' };
  }

  const shouldExcludeCli = depGraph.shouldExcludeCli?.bind(depGraph);
  const allFiles = (depGraph.getAllFilePaths?.() || []).filter((f) => !shouldExcludeCli || !shouldExcludeCli(f));
  const mainlineFiles = allFiles.filter((f) => {
    const c = projectContext.classifyFile(f);
    return c.isMainline && c.fileRole !== 'test' && c.fileRole !== 'docs' && c.fileRole !== 'style' && c.fileRole !== 'asset';
  });
  const scope = typeof depGraph.getScopeSummary === 'function' ? depGraph.getScopeSummary() : null;
  const entryFiles = scope?.entryFiles || [];
  const skeleton = buildSkeleton(root, depGraph, allFiles, mainlineFiles, projectContext, entryFiles);

  const aggregate = depGraph.analyzer?.getAggregateCache?.();
  const hasValidAggregate = aggregate && aggregate.version === depGraph.analyzer?.getAggregateVersion?.();
  let hotspots = (hasValidAggregate && aggregate?.hotspots) ? aggregate.hotspots : null;
  let stability = (hasValidAggregate && aggregate?.stability) ? aggregate.stability : null;

  if ((!hotspots || !stability) && container.ensurePrecomputed) {
    await container.ensurePrecomputed(['overview']);
    const refreshed = depGraph.analyzer?.getAggregateCache?.();
    const refreshedValid = refreshed && refreshed.version === depGraph.analyzer?.getAggregateVersion?.();
    hotspots = (refreshedValid && refreshed.hotspots) ? refreshed.hotspots : hotspots;
    stability = (refreshedValid && refreshed.stability) ? refreshed.stability : stability;
  }

  hotspots = hotspots || await buildHotspots(root, depGraph, mainlineFiles, historyProvider);
  stability = stability || buildStability(root, depGraph, mainlineFiles, projectContext);
  const orphans = depGraph.findOrphanFiles();
  const unresolvedRaw = depGraph.findUnresolvedImports?.() || [];
  const cyclesRaw = depGraph.findCircularDependencies?.() || [];
  const deadExportsRaw = depGraph.findDeadExports?.() || [];

  const { checkAllRules } = require('../services/dep-graph/ast-rules');
  let astRulesRaw = [];
  if (depGraph && depGraph.graph) {
    astRulesRaw = checkAllRules(depGraph.graph);
  }

  if (args?.severity) {
    const SEVERITY_RANK = { high: 3, medium: 2, low: 1 };
    astRulesRaw = astRulesRaw.filter((f) => {
      const itemSeverity = f.severity || 'low';
      const minSeverity = args.severity;
      if (!minSeverity || !SEVERITY_RANK[minSeverity]) return true;
      return (SEVERITY_RANK[itemSeverity] || 0) >= SEVERITY_RANK[minSeverity];
    });
  }

  const ignoreFindings = projectContext?.config?.ignore?.findings;
  if (ignoreFindings?.length > 0) {
    const ignoredSet = new Set(ignoreFindings);
    astRulesRaw = astRulesRaw.filter((f) => !ignoredSet.has(f.id));
  }

  let filteredDeadExportsRaw = deadExportsRaw;
  if (args?.severity) {
    const SEVERITY_RANK = { high: 3, medium: 2, low: 1 };
    filteredDeadExportsRaw = deadExportsRaw.filter((d) => {
      const itemSeverity = d.confidence || 'medium';
      const minSeverity = args.severity;
      if (!minSeverity || !SEVERITY_RANK[minSeverity]) return true;
      return (SEVERITY_RANK[itemSeverity] || 0) >= SEVERITY_RANK[minSeverity];
    });
  }

  const sections = {
    deadExports: {
      ok: true,
      deadExportsCount: filteredDeadExportsRaw.length,
      deadExports: filteredDeadExportsRaw,
    },
    unresolved: {
      ok: true,
      unresolvedCount: unresolvedRaw.length,
      unresolved: unresolvedRaw,
    },
    cycles: {
      ok: true,
      cyclesCount: cyclesRaw.length,
      cycles: cyclesRaw,
    },
    astRules: {
      ok: true,
      findingsCount: astRulesRaw.length,
      findings: astRulesRaw,
    },
  };

  const { filterByCategory } = require('./category-filter');
  filterByCategory(sections, args?.category, ['deadExports', 'unresolved', 'cycles', 'astRules']);

  const deadExports = sections.deadExports;
  const filteredDeadExports = deadExports.deadExports;
  const unresolved = sections.unresolved.unresolved;
  const cycles = sections.cycles.cycles;
  const astRules = sections.astRules;

  const stack = detectStack(root);
  const stackProfile = stack.profile;

  let unresolvedFp = null;
  if (unresolved.length > 0) {
    const classifications = classifyUnresolved(unresolved, root);
    const summary = buildClassificationSummary(classifications);
    unresolvedFp = { count: summary.falsePositiveCount, total: summary.total, primaryReason: summary.primaryReason };
  }

  let deadExportsFp = null;
  if (filteredDeadExports.length > 0) {
    const classifications = classifyDeadExports(filteredDeadExports, depGraph);
    const summary = buildClassificationSummary(classifications);
    deadExportsFp = { count: summary.falsePositiveCount, total: summary.total, primaryReason: summary.primaryReason };
  }

  const severityRelevantDeadExportsCount = filteredDeadExports.filter(
    (d) => !d.falsePositiveReason || !DEAD_EXPORT_FALSE_POSITIVE_REASONS.has(d.falsePositiveReason)
  ).length;

  const issueContext = {
    unresolved: { count: unresolved.length, fp: unresolvedFp, omitted: sections.unresolved.omitted },
    cycles: { count: cycles.length, omitted: sections.cycles.omitted },
    deadExports: {
      count: filteredDeadExports.length,
      severityRelevantCount: severityRelevantDeadExportsCount,
      fp: deadExportsFp,
      omitted: sections.deadExports.omitted,
    },
  };
  const cycleRefactorSuggestions = sections.cycles.omitted ? [] : buildCycleRefactorSuggestions(root, depGraph, projectContext);
  const couplingSplitSuggestions = buildCouplingSplitSuggestions(root, depGraph, mainlineFiles, projectContext);
  const { summary, orphanCount } = buildOverviewSummary(hotspots, stability, orphans, issueContext, stackProfile, stack, cycleRefactorSuggestions, couplingSplitSuggestions);
  const aggregates = aggregateOverviewStats(hotspots, stability);

  const dgStats = depGraph.getStats?.() || {};
  const analysisCoverage = dgStats.filteredAnalysisCoverage !== undefined ? dgStats.filteredAnalysisCoverage : dgStats.analysisCoverage;
  if (analysisCoverage && analysisCoverage.coverageRatio < 0.5) {
    summary.severity = 'high';
    summary.recommendations.unshift(`WARNING: Analysis coverage is low (${Math.round(analysisCoverage.coverageRatio * 100)}%); findings may be incomplete.`);
  }

  summary.counts = {
    ...(sections.deadExports.omitted ? {} : { deadExports: filteredDeadExports.length }),
    ...(sections.unresolved.omitted ? {} : { unresolved: unresolved.length }),
    ...(sections.cycles.omitted ? {} : { cycles: cycles.length }),
    ...(sections.astRules.omitted ? {} : { astRules: astRules.findingsCount }),
    missingHygieneChecks: 0,
  };
  if (analysisCoverage) summary.analysisCoverage = analysisCoverage;

  const nowIso = args?.now || new Date().toISOString();
  const trendGranularity = args?.trendGranularity === 'week' ? 'week' : 'day';

  // Per-file blame is opt-in. When history is not requested we return an empty
  // bucket with a disabledReason so consumers can distinguish "no data" from
  // "no risk" and avoid paying the blame cost on the hot path.
  const shouldComputeHistory = Boolean(historyProvider) || args?.withHistory === true;
  const knowledgeRisk = shouldComputeHistory
    ? await buildKnowledgeRisk(root, mainlineFiles, container.gitEnvironment)
    : buildEmptyKnowledgeRisk('history-not-enabled');

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
    knowledgeRisk,
    mainlineFiles,
    orphanCount,
    orphans,
    analysisCoverage,
    cycleRefactorSuggestions,
    couplingSplitSuggestions,
    nowIso,
    trendGranularity,
    deadExports: {
      ok: true,
      deadExportsCount: filteredDeadExports.length,
      deadExports: filteredDeadExports,
      possibleFalsePositives: deadExportsFp,
    },
    unresolved: {
      ok: true,
      unresolvedCount: unresolved.length,
      unresolved: unresolved,
      possibleFalsePositives: unresolvedFp,
    },
    cycles: {
      ok: true,
      cyclesCount: cycles.length,
      cycles: cycles,
    },
    astRules,
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
  buildKnowledgeRisk,
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
