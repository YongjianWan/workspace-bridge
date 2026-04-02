/**
 * Project Overview - Milestone 5: 全景视图
 * 整合 dep-graph、project-context、git 历史，生成工程上帝视角
 */
const path = require('path');
const fs = require('fs');
const { getFileHistoryRisk } = require('./git-tools');
const { toRelativePosix } = require('../utils/path');

function toRelative(root, filePath) {
  return toRelativePosix(root, filePath);
}

function calculateHotspotScore(historyRisk) {
  if (!historyRisk) return 0;

  let score = 0;
  const churn = historyRisk.commitCount ?? historyRisk.churn ?? 0;
  score += Math.min(churn, 10) * 2;
  score += (historyRisk.authorCount || 1) * 3;
  if (historyRisk.lastModifiedDaysAgo !== undefined && historyRisk.lastModifiedDaysAgo !== null) {
    score += Math.max(0, 30 - historyRisk.lastModifiedDaysAgo) * 0.5;
  }
  score += (historyRisk.revertLikeCount || 0) * 5;

  return Math.min(Math.round(score), 100);
}

function calculateStabilityScore(classification, impactCount, hasTests, inCycle) {
  let score = 50;
  if (hasTests) score += 20;
  if (impactCount < 5) score += 10;
  else if (impactCount > 20) score -= 10;
  if (!classification?.isMainline) score -= 10;
  if (inCycle) score -= 15;
  if (classification?.fileRole === 'config') score += 10;
  return Math.max(0, Math.min(100, score));
}

function calculateCoupling(dependencies, dependents) {
  const inDegree = dependents?.length || 0;
  const outDegree = dependencies?.length || 0;
  const total = inDegree + outDegree;
  return {
    inDegree,
    outDegree,
    total,
    level: total > 20 ? 'high' : total > 10 ? 'medium' : 'low',
  };
}

function findOrphanFiles(files, entryFiles, graph, root) {
  const orphans = { docs: [], scripts: [], configs: [], modules: [] };

  for (const file of files) {
    const relativePath = toRelative(root, file);
    const ext = path.extname(file).toLowerCase();
    const base = path.basename(file);
    if (graph.isTestLikeFile?.(file)) continue;
    const dependents = graph.getDependents?.(file) || [];
    const isEntry = entryFiles.has?.(file) || entryFiles.includes?.(file);
    const isImported = dependents.length > 0;
    if (isEntry || isImported) continue;

    if (ext === '.md' || ext === '.mdx' || base.toLowerCase().includes('readme')) {
      orphans.docs.push(relativePath);
    } else if (relativePath.includes('/scripts/') || relativePath.includes('/bin/')) {
      orphans.scripts.push(relativePath);
    } else if (ext === '.json' || ext === '.yaml' || ext === '.yml' || ext === '.toml') {
      orphans.configs.push(relativePath);
    } else if (['.js', '.ts', '.py', '.go', '.rs', '.java'].includes(ext)) {
      orphans.modules.push(relativePath);
    }
  }

  return orphans;
}

function identifyCoreModules(graph, files, projectContext, root) {
  const candidates = [];

  for (const file of files) {
    const classification = projectContext?.classifyFile?.(file);
    if (!classification?.isMainline) continue;
    const dependents = graph.getDependents?.(file) || [];
    if (dependents.length >= 3 && classification.fileRole === 'library') {
      candidates.push({
        file: toRelative(root, file),
        dependentCount: dependents.length,
        reason: `被 ${dependents.length} 个模块依赖`,
      });
    }
  }

  return candidates.sort((a, b) => b.dependentCount - a.dependentCount).slice(0, 10);
}

async function getHistoryRisk(root, filePath, historyProvider) {
  try {
    const result = await historyProvider(root, filePath, { limit: 25 });
    if (result?.ok === false) return null;
    return result?.historyRisk || null;
  } catch (e) {
    if (process.env.DEBUG) {
      console.error(`[overview] Failed to get history for ${filePath}:`, e.message);
    }
    return null;
  }
}

function buildSkeleton(root, depGraph, allFiles, mainlineFiles, projectContext) {
  return {
    entryPoints: Array.from(depGraph.entryFiles || []).map((f) => toRelative(root, f)),
    totalFiles: allFiles.length,
    mainlineFiles: mainlineFiles.length,
    testFiles: allFiles.filter((f) => depGraph.isTestLikeFile(f)).length,
    coreModules: identifyCoreModules(depGraph, allFiles, projectContext, root),
  };
}

async function buildHotspots(root, depGraph, mainlineFiles, historyProvider) {
  const candidates = await Promise.all(
    mainlineFiles.slice(0, 50).map(async (file) => {
      const relativePath = toRelative(root, file);
      const dependents = depGraph.getDependents?.(file) || [];
      const dependencies = depGraph.getDependencies?.(file) || [];
      const historyRisk = await getHistoryRisk(root, file, historyProvider);
      const score = calculateHotspotScore(historyRisk);
      const coupling = calculateCoupling(dependencies, dependents);
      if (score <= 30 && coupling.total <= 10) return null;
      return {
        file: relativePath,
        score,
        risk: historyRisk?.level || 'low',
        coupling: coupling.total,
        reason: historyRisk?.signals?.[0] || `${coupling.total} 个依赖连接`,
      };
    })
  );

  return candidates.filter(Boolean).sort((a, b) => b.score - a.score);
}

function buildStability(root, depGraph, mainlineFiles, projectContext) {
  const stability = [];
  const allCycles = depGraph.findCircularDependencies?.() || [];
  const filesInCycle = new Set(allCycles.flat());

  for (const file of mainlineFiles.slice(0, 30)) {
    const relativePath = toRelative(root, file);
    const classification = projectContext.classifyFile(file);
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
      assessment: score >= 70 ? 'stable' : score >= 40 ? 'moderate' : 'fragile',
    });
  }

  return stability.sort((a, b) => a.stabilityScore - b.stabilityScore);
}

function buildOverviewSummary(hotspots, stability, orphans) {
  const summary = { severity: 'low', insights: [], recommendations: [] };

  if (hotspots.length > 0) {
    summary.insights.push(`发现 ${hotspots.length} 个热区文件，需要重点关注`);
  }

  const fragileModules = stability.filter((s) => s.assessment === 'fragile');
  if (fragileModules.length > 0) {
    summary.insights.push(`${fragileModules.length} 个模块稳定性较差`);
    summary.severity = 'medium';
  }

  const orphanCount = Object.values(orphans).flat().length;
  if (orphanCount > 0) {
    summary.insights.push(`发现 ${orphanCount} 个孤儿文件（可能未使用）`);
  }

  if (hotspots.length > 0) {
    summary.recommendations.push(`优先审查热区文件: ${hotspots.slice(0, 3).map((h) => h.file).join(', ')}`);
  }
  if (fragileModules.length > 0) {
    summary.recommendations.push(`为脆弱模块添加测试: ${fragileModules.slice(0, 3).map((s) => s.file).join(', ')}`);
  }
  if (orphans.modules.length > 0) {
    summary.recommendations.push(`审查孤儿模块是否可删除: ${orphans.modules.slice(0, 3).join(', ')}`);
  }

  return { summary, orphanCount };
}

function normalizeCycle(cycle) {
  const list = Array.isArray(cycle) ? cycle.slice() : [];
  if (list.length > 1 && list[0] === list[list.length - 1]) {
    list.pop();
  }
  return list;
}

function pickBreakEdge(depGraph, cycleFiles) {
  if (!Array.isArray(cycleFiles) || cycleFiles.length < 2) return null;
  const edges = [];
  for (let i = 0; i < cycleFiles.length; i += 1) {
    const from = cycleFiles[i];
    const to = cycleFiles[(i + 1) % cycleFiles.length];
    const fromDependents = depGraph.getDependents?.(from) || [];
    const fromDependencies = depGraph.getDependencies?.(from) || [];
    const score = (fromDependents.length * 2) + fromDependencies.length;
    edges.push({ from, to, score, fromDependents: fromDependents.length, fromDependencies: fromDependencies.length });
  }

  return edges.sort((a, b) => a.score - b.score)[0] || null;
}

function buildCycleRefactorSuggestions(root, depGraph, projectContext) {
  const cycles = depGraph.findCircularDependencies?.() || [];
  const normalized = cycles.map(normalizeCycle).filter((cycle) => cycle.length >= 2);
  const suggestions = [];

  for (let i = 0; i < normalized.length; i += 1) {
    const cycleFiles = normalized[i];
    const edge = pickBreakEdge(depGraph, cycleFiles);
    if (!edge) continue;
    const cycleRelative = cycleFiles.map((file) => toRelative(root, file));
    const fromRole = projectContext?.classifyFile?.(edge.from)?.fileRole || 'library';
    suggestions.push({
      cycleId: `cycle-${i + 1}`,
      cycleSize: cycleFiles.length,
      cycle: cycleRelative,
      breakCandidate: {
        from: toRelative(root, edge.from),
        to: toRelative(root, edge.to),
        reason: `优先切断低影响边（from dependents=${edge.fromDependents}, dependencies=${edge.fromDependencies}, role=${fromRole}）`,
      },
      actions: [
        `将 ${toRelative(root, edge.from)} 对 ${toRelative(root, edge.to)} 的直接依赖改为接口/回调注入`,
        `把共享常量或类型下沉到独立模块，避免双向 import`,
      ],
      validation: {
        command: 'node cli.js cycles --cwd . --json --quiet',
        expectation: 'cycleCount 下降或至少该 cycle 不再出现',
      },
    });
  }

  return suggestions.slice(0, 10);
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
    schemaVersion: 1,
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

async function writeHotspotDataFile(filePath, payload) {
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
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

async function readTrendHistory(filePath) {
  if (!fs.existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
    return Array.isArray(parsed?.history) ? parsed.history : [];
  } catch (e) {
    return [];
  }
}

async function writeStabilityTrendFile(filePath, payload) {
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function buildProjectOverview(args, container) {
  await container.ensureReady();

  const root = container.workspaceRoot;
  const depGraph = container.depGraph;
  const projectContext = depGraph?.projectContext;
  const historyProvider = args?.historyProvider || getFileHistoryRisk;

  if (!depGraph || !projectContext) {
    return { ok: false, error: 'Dependency graph not initialized' };
  }

  const allFiles = Array.from(depGraph.graph?.keys() || []);
  const mainlineFiles = allFiles.filter((f) => projectContext.classifyFile(f).isMainline);
  const skeleton = buildSkeleton(root, depGraph, allFiles, mainlineFiles, projectContext);
  const hotspots = await buildHotspots(root, depGraph, mainlineFiles, historyProvider);
  const stability = buildStability(root, depGraph, mainlineFiles, projectContext);
  const orphans = findOrphanFiles(allFiles, depGraph.entryFiles, depGraph, root);
  const { summary, orphanCount } = buildOverviewSummary(hotspots, stability, orphans);
  const aggregates = aggregateOverviewStats(hotspots, stability);
  const cycleRefactorSuggestions = buildCycleRefactorSuggestions(root, depGraph, projectContext);
  if (cycleRefactorSuggestions.length > 0) {
    summary.recommendations.push(`先处理循环依赖: ${cycleRefactorSuggestions.slice(0, 2).map((item) => item.breakCandidate.from).join(', ')}`);
  }
  const hotspotData = buildHotspotVisualizationData(root, hotspots, aggregates);
  const nowIso = args?.now || new Date().toISOString();
  const trendGranularity = args?.trendGranularity === 'week' ? 'week' : 'day';
  const stabilityTrendSnapshot = buildStabilityTrendSnapshot(nowIso, stability, aggregates);
  const stabilityTrend = {
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
  let hotspotDataFile = null;
  if (args?.hotspotData) {
    const target = path.isAbsolute(args.hotspotData)
      ? args.hotspotData
      : path.resolve(root, args.hotspotData);
    await writeHotspotDataFile(target, hotspotData);
    hotspotDataFile = target;
  }
  let stabilityTrendDataFile = null;
  if (args?.stabilityTrendData) {
    const target = path.isAbsolute(args.stabilityTrendData)
      ? args.stabilityTrendData
      : path.resolve(root, args.stabilityTrendData);
    const existingHistory = await readTrendHistory(target);
    const history = [...existingHistory, stabilityTrendSnapshot];
    const series = buildStabilityTrendSeries(history, trendGranularity);
    const payload = {
      schemaVersion: 1,
      generatedAt: nowIso,
      workspaceRoot: root,
      granularity: trendGranularity,
      history,
      series,
    };
    await writeStabilityTrendFile(target, payload);
    stabilityTrendDataFile = target;
    stabilityTrend.series = series;
  }

  return {
    ok: true,
    workspaceRoot: root,
    options: {
      hotspotData: {
        enabled: Boolean(args?.hotspotData),
        path: args?.hotspotData || null,
      },
      stabilityTrendData: {
        enabled: Boolean(args?.stabilityTrendData),
        path: args?.stabilityTrendData || null,
        granularity: trendGranularity,
      },
    },
    summary,
    aggregates,
    skeleton,
    hotspots: hotspots.slice(0, 10),
    architectureAdvice: {
      cycleRefactorSuggestions,
    },
    hotspotData,
    hotspotDataFile,
    stabilityTrend,
    stabilityTrendDataFile,
    stability: stability.slice(0, 10),
    orphans: {
      counts: {
        docs: orphans.docs.length,
        scripts: orphans.scripts.length,
        configs: orphans.configs.length,
        modules: orphans.modules.length,
        total: orphanCount,
      },
      samples: {
        docs: orphans.docs.slice(0, 5),
        scripts: orphans.scripts.slice(0, 5),
        configs: orphans.configs.slice(0, 5),
        modules: orphans.modules.slice(0, 5),
      },
    },
  };
}

module.exports = {
  buildProjectOverview,
  buildHotspotVisualizationData,
  buildStabilityTrendSnapshot,
  buildStabilityTrendSeries,
};
