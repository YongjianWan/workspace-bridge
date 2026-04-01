/**
 * Project Overview - Milestone 5: 全景视图
 * 整合 dep-graph、project-context、git 历史，生成工程上帝视角
 */
const path = require('path');
const { getFileHistoryRisk } = require('./git-tools');

function toRelative(root, filePath) {
  return path.relative(root, filePath).replace(/\\/g, '/');
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

  return {
    ok: true,
    workspaceRoot: root,
    summary,
    skeleton,
    hotspots: hotspots.slice(0, 10),
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
};
