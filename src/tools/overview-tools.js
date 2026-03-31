/**
 * Project Overview - Milestone 5: 全景视图
 * 整合 dep-graph、project-context、git 历史，生成工程上帝视角
 */
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const readFile = promisify(fs.readFile);
const { getFileHistoryRisk } = require('./git-tools');

/**
 * 计算文件热区分数（基于历史风险）
 */
function calculateHotspotScore(historyRisk) {
  if (!historyRisk) return 0;
  
  let score = 0;
  // 改动频率
  score += Math.min(historyRisk.churn || 0, 10) * 2;
  // 作者分散度
  score += (historyRisk.authorCount || 1) * 3;
  // 最近改动
  if (historyRisk.lastModifiedDaysAgo !== undefined) {
    score += Math.max(0, 30 - historyRisk.lastModifiedDaysAgo) * 0.5;
  }
  // 回滚痕迹
  score += (historyRisk.revertLikeCount || 0) * 5;
  
  return Math.min(Math.round(score), 100);
}

/**
 * 计算模块稳定性评分
 * 基于：测试覆盖、改动频率、循环依赖
 */
function calculateStabilityScore(filePath, classification, impactCount, hasTests, inCycle) {
  let score = 50; // 基础分
  
  // 有测试覆盖 +20
  if (hasTests) score += 20;
  
  // 影响面小 +10
  if (impactCount < 5) score += 10;
  else if (impactCount > 20) score -= 10;
  
  // 非主线代码 -10（稳定性要求较低）
  if (!classification?.isMainline) score -= 10;
  
  // 循环依赖 -15
  if (inCycle) score -= 15;
  
  // 配置文件视为稳定
  if (classification?.fileRole === 'config') score += 10;
  
  return Math.max(0, Math.min(100, score));
}

/**
 * 计算耦合度
 * 基于：入度 + 出度
 */
function calculateCoupling(dependencies, dependents) {
  const inDegree = dependents?.length || 0;
  const outDegree = dependencies?.length || 0;
  
  return {
    inDegree,
    outDegree,
    total: inDegree + outDegree,
    level: inDegree + outDegree > 20 ? 'high' : inDegree + outDegree > 10 ? 'medium' : 'low',
  };
}

/**
 * 检测孤儿文件
 */
function findOrphanFiles(files, entryFiles, graph, root) {
  const orphans = {
    docs: [],
    scripts: [],
    configs: [],
    modules: [],
  };
  
  for (const file of files) {
    const relativePath = path.relative(root, file).replace(/\\/g, '/');
    const ext = path.extname(file).toLowerCase();
    const base = path.basename(file);
    
    // 检查是否被引用
    const dependents = graph.getDependents?.(file) || [];
    const isEntry = entryFiles.has?.(file) || entryFiles.includes?.(file);
    const isImported = dependents.length > 0;
    
    // 如果是入口或被引用，不是孤儿
    if (isEntry || isImported) continue;
    
    // 分类检测
    if (ext === '.md' || ext === '.mdx' || base.toLowerCase().includes('readme')) {
      orphans.docs.push(relativePath);
    } else if (relativePath.includes('/scripts/') || relativePath.includes('/bin/')) {
      orphans.scripts.push(relativePath);
    } else if (ext === '.json' || ext === '.yaml' || ext === '.yml' || ext === '.toml') {
      orphans.configs.push(relativePath);
    } else if (['.js', '.ts', '.py', '.go', '.rs'].includes(ext)) {
      orphans.modules.push(relativePath);
    }
  }
  
  return orphans;
}

/**
 * 识别核心模块
 * 基于：PageRank 或依赖中心性
 */
function identifyCoreModules(graph, files, projectContext) {
  const candidates = [];
  
  for (const file of files) {
    const classification = projectContext?.classifyFile?.(file);
    if (!classification?.isMainline) continue;
    
    const dependents = graph.getDependents?.(file) || [];
    const dependencies = graph.getDependencies?.(file) || [];
    
    // 被多个模块依赖，且是 library 角色的，是核心模块
    if (dependents.length >= 3 && classification.fileRole === 'library') {
      candidates.push({
        file: path.relative(projectContext?.root || '', file).replace(/\\/g, '/'),
        dependentCount: dependents.length,
        reason: `被 ${dependents.length} 个模块依赖`,
      });
    }
  }
  
  return candidates
    .sort((a, b) => b.dependentCount - a.dependentCount)
    .slice(0, 10);
}

/**
 * 生成项目全景视图
 */
async function buildProjectOverview(args, container) {
  await container.ensureReady();
  
  const root = container.workspaceRoot;
  const depGraph = container.depGraph;
  const projectContext = depGraph?.projectContext;
  
  if (!depGraph || !projectContext) {
    return { ok: false, error: 'Dependency graph not initialized' };
  }
  
  // 获取所有文件
  const allFiles = Array.from(depGraph.graph?.keys() || []);
  const mainlineFiles = allFiles.filter(f => projectContext.classifyFile(f).isMainline);
  
  // 1. 项目骨架
  const skeleton = {
    entryPoints: Array.from(depGraph.entryFiles || []).map(f => 
      path.relative(root, f).replace(/\\/g, '/')
    ),
    totalFiles: allFiles.length,
    mainlineFiles: mainlineFiles.length,
    testFiles: allFiles.filter(f => depGraph.isTestLikeFile(f)).length,
    coreModules: identifyCoreModules(depGraph, allFiles, projectContext),
  };
  
  // 2. 热区图
  const hotspots = [];
  for (const file of mainlineFiles.slice(0, 50)) { // 只分析主线文件
    const relativePath = path.relative(root, file).replace(/\\/g, '/');
    const dependents = depGraph.getDependents?.(file) || [];
    const dependencies = depGraph.getDependencies?.(file) || [];
    
    // 获取历史风险（异步）
    let historyRisk = null;
    try {
      historyRisk = await getFileHistoryRisk(file, root);
    } catch (e) {
      if (process.env.DEBUG) {
        console.error(`[overview] Failed to get history for ${file}:`, e.message);
      }
    }
    
    const score = calculateHotspotScore(historyRisk);
    const coupling = calculateCoupling(dependencies, dependents);
    
    if (score > 30 || coupling.total > 10) {
      hotspots.push({
        file: relativePath,
        score,
        risk: historyRisk?.level || 'low',
        coupling: coupling.total,
        reason: historyRisk?.signals?.[0] || `${coupling.total} 个依赖连接`,
      });
    }
  }
  hotspots.sort((a, b) => b.score - a.score);
  
  // 3. 稳定性与耦合度
  const stability = [];
  const allCycles = depGraph.findCircularDependencies?.() || [];
  const filesInCycle = new Set(allCycles.flat());
  
  for (const file of mainlineFiles.slice(0, 30)) {
    const relativePath = path.relative(root, file).replace(/\\/g, '/');
    const classification = projectContext.classifyFile(file);
    const dependents = depGraph.getDependents?.(file) || [];
    const dependencies = depGraph.getDependencies?.(file) || [];
    
    const hasTests = dependents.some(d => depGraph.isTestLikeFile(d));
    const inCycle = filesInCycle.has(file);
    
    const score = calculateStabilityScore(file, classification, dependents.length, hasTests, inCycle);
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
  stability.sort((a, b) => a.stabilityScore - b.stabilityScore); // 稳定性差的在前
  
  // 4. 孤儿检测
  const orphans = findOrphanFiles(allFiles, depGraph.entryFiles, depGraph, root);
  
  // 5. 主线视图汇总
  const summary = {
    severity: 'low',
    insights: [],
    recommendations: [],
  };
  
  // 生成洞察
  if (hotspots.length > 0) {
    summary.insights.push(`发现 ${hotspots.length} 个热区文件，需要重点关注`);
  }
  
  const fragileModules = stability.filter(s => s.assessment === 'fragile');
  if (fragileModules.length > 0) {
    summary.insights.push(`${fragileModules.length} 个模块稳定性较差`);
    summary.severity = 'medium';
  }
  
  const orphanCount = Object.values(orphans).flat().length;
  if (orphanCount > 0) {
    summary.insights.push(`发现 ${orphanCount} 个孤儿文件（可能未使用）`);
  }
  
  // 生成建议
  if (hotspots.length > 0) {
    summary.recommendations.push(`优先审查热区文件: ${hotspots.slice(0, 3).map(h => h.file).join(', ')}`);
  }
  if (fragileModules.length > 0) {
    summary.recommendations.push(`为脆弱模块添加测试: ${fragileModules.slice(0, 3).map(s => s.file).join(', ')}`);
  }
  if (orphans.modules.length > 0) {
    summary.recommendations.push(`审查孤儿模块是否可删除: ${orphans.modules.slice(0, 3).join(', ')}`);
  }
  
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
