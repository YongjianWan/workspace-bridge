/**
 * Overview Curator — generates human-readable recommendations and suggestions
 * from raw overview data. Separated from overview-tools.js to eliminate
 * mixing data computation with curation/formatting logic.
 */
const { overviewSeverity } = require('../config/risk-thresholds');
const { DEFAULTS, SCORING } = require('../config/constants');
const { toRelativePosix } = require('../utils/path');
const {
  buildUnresolvedRecommendation,
  buildCycleRecommendation,
  buildDeadExportRecommendation,
} = require('../utils/recommendations');

function toRelative(root, filePath) {
  return toRelativePosix(root, filePath);
}

function buildOverviewSummary(
  hotspots,
  stability,
  orphans,
  issueContext = {},
  stackProfile = 'unknown',
  stack = null,
  cycleRefactorSuggestions = [],
  couplingSplitSuggestions = []
) {
  const summary = { severity: 'low', insights: [], recommendations: [] };
  const unresolvedCount = issueContext.unresolved?.omitted ? null : (issueContext.unresolved?.count || 0);
  const cyclesCount = issueContext.cycles?.omitted ? null : (issueContext.cycles?.count || 0);
  const deadExportsCount = issueContext.deadExports?.omitted ? null : (issueContext.deadExports?.count || 0);

  if (hotspots.length > 0) {
    summary.insights.push(`发现 ${hotspots.length} 个热区文件，需要重点关注`);
  }

  const fragileModules = stability.filter((s) => s.assessment === 'fragile');
  if (fragileModules.length > 0) {
    summary.insights.push(`${fragileModules.length} 个模块稳定性较差`);
  }

  const orphanCount = orphans.all.length;
  if (orphanCount > 0) {
    summary.insights.push(`发现 ${orphanCount} 个孤儿文件（可能未使用）`);
  }
  if (unresolvedCount !== null && unresolvedCount > 0) {
    summary.insights.push(`${unresolvedCount} 个未解析的 import`);
  }
  if (cyclesCount !== null && cyclesCount > 0) {
    summary.insights.push(`${cyclesCount} 个循环依赖`);
  }
  if (deadExportsCount !== null && deadExportsCount > 0) {
    summary.insights.push(`${deadExportsCount} 个死导出候选`);
  }

  summary.severity = overviewSeverity({
    fragileModuleCount: fragileModules.length,
    unresolved: unresolvedCount || 0,
    cycles: cyclesCount || 0,
    deadExports: deadExportsCount || 0,
    orphans: orphanCount,
  });

  // Stack-profile-aware recommendation ordering and wording
  const isNode = stackProfile === 'node-first' || stackProfile === 'mixed';
  const isJava = stackProfile === 'java-first';
  const isPython = stackProfile === 'python-first';
  const isGo = stackProfile === 'go-first';
  const isRust = stackProfile === 'rust-first';

  const unresolvedRec = unresolvedCount === null ? null : buildUnresolvedRecommendation(unresolvedCount, issueContext.unresolved?.fp, stack);
  const cycleRec = cyclesCount === null ? null : buildCycleRecommendation(cyclesCount, stack);
  const deadExportRec = deadExportsCount === null ? null : buildDeadExportRecommendation(deadExportsCount, issueContext.deadExports?.fp, stack);
  if (unresolvedRec) summary.recommendations.push(unresolvedRec);
  if (cycleRec) summary.recommendations.push(cycleRec);
  if (deadExportRec) summary.recommendations.push(deadExportRec);
  if (hotspots.length > 0) {
    summary.recommendations.push(
      `优先审查热区文件: ${hotspots.slice(0, SCORING.TOP_N_RECOMMENDATIONS).map((h) => h.file).join(', ')}`
    );
  }
  if (fragileModules.length > 0) {
    summary.recommendations.push(
      `为脆弱模块添加测试: ${fragileModules.slice(0, SCORING.TOP_N_RECOMMENDATIONS).map((s) => s.file).join(', ')}`
    );
  }
  if (orphans.modules.length > 0) {
    summary.recommendations.push(
      `审查孤儿模块是否可删除: ${orphans.modules.slice(0, SCORING.TOP_N_RECOMMENDATIONS).join(', ')}`
    );
  }

  if (cycleRefactorSuggestions.length > 0) {
    summary.recommendations.push(
      `先处理循环依赖: ${cycleRefactorSuggestions.slice(0, 2).map((item) => item.breakCandidate.from).join(', ')}`
    );
  }
  if (couplingSplitSuggestions.length > 0) {
    summary.recommendations.push(
      `高耦合模块拆分优先级: ${couplingSplitSuggestions.slice(0, 2).map((item) => item.file).join(', ')}`
    );
  }

  // Stack-specific advice appended at the end
  if (isNode) {
    summary.recommendations.push('Node 项目建议：运行 linter + type-check 作为日常验证基线。');
  } else if (isJava) {
    summary.recommendations.push('Java 项目建议：运行 Maven/Gradle compile + surefire 测试作为日常验证基线。');
  } else if (isPython) {
    summary.recommendations.push('Python 项目建议：运行 pytest + ruff 作为日常验证基线。');
  } else if (isGo) {
    summary.recommendations.push('Go 项目建议：运行 go build ./... + go vet 作为日常验证基线。');
  } else if (isRust) {
    summary.recommendations.push('Rust 项目建议：运行 cargo check + cargo clippy 作为日常验证基线。');
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
    const score = (fromDependents.length * SCORING.BREAK_EDGE_DEPENDENT_WEIGHT) + fromDependencies.length;
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
        command: 'workspace-bridge-cli cycles --cwd . --json --quiet',
        expectation: 'cyclesCount 下降或至少该 cycle 不再出现',
      },
    });
  }

  return suggestions.slice(0, SCORING.TOP_N_LIST);
}

const COUPLING_ADVICE_RULES = [
  { match: (r, inD) => r === 'entry', advice: ['entry 点天然需要聚合依赖，关注是否可提取子命令分发层', '避免在 entry 中直接包含业务实现，将具体逻辑下沉到独立服务'] },
  { match: (r, inD, outD) => inD > 0 && outD === 0, advice: ['被大量模块依赖，修改影响面大，建议保持接口稳定，新增功能优先开新模块', '保持原子性，避免吸收不相关职责；若规模膨胀再按主题拆分'] },
  { match: (r, inD, outD) => inD === 0 && outD > 0, advice: ['零被依赖但高 outward 耦合，检查是否有重复初始化逻辑可下沉为独立模块', '评估是否可通过依赖注入或工厂模式减少直接引用数量'] },
  { match: (r) => r === 'script', advice: ['工具模块被多处引用，提取可复用核心逻辑到独立库，避免业务状态沉淀', '保持工具函数无副作用，按领域拆分为专用工具子模块'] },
  { match: (r) => r === 'test', advice: ['测试文件耦合高通常正常，关注是否可提取公共测试 fixture 到独立 helper', '避免测试间相互 import，保持测试隔离性'] },
  { match: (r) => r === 'config', advice: ['配置模块被多处引用时，考虑按环境或领域拆分为独立配置文件', '提取配置验证逻辑到独立模块，避免配置解析散落在各处'] },
];

function generateCouplingSplitPlan(role, coupling, isSmallProject) {
  const { inDegree, outDegree } = coupling;

  // L3-3: suppress aggressive split advice for small monoliths
  if (isSmallProject && role === 'library') {
    return [
      '项目规模较小，保持内聚优先；高耦合模块建议通过测试覆盖降低修改风险',
      '关注接口稳定性，待规模增长后再评估是否物理拆分',
    ];
  }

  const rule = COUPLING_ADVICE_RULES.find((r) => r.match(role, inDegree, outDegree));
  if (rule) return rule.advice;

  // Differentiated by coupling shape for library / generic roles
  if (inDegree > outDegree * 2) {
    return [
      '作为核心服务被大量依赖，建议按子域拆分为独立服务模块，降低变更影响面',
      '提取内部通用逻辑到共享库，避免每个调用方直接依赖实现细节',
    ];
  }
  if (outDegree > inDegree * 2) {
    return [
      '依赖外部模块过多，建议引入 facade 或防腐层统一封装外部调用',
      '按业务场景拆分编排逻辑，避免单个模块成为全站依赖汇聚点',
    ];
  }
  if (inDegree >= 3 && outDegree >= 3) {
    return [
      '双向耦合严重，考虑提取接口契约层，让调用方依赖抽象而非实现',
      '评估是否可拆分为读服务 + 写服务，或按数据生命周期阶段分离职责',
    ];
  }
  return [
    '同时被依赖和依赖他人，考虑提取接口层或 facade 打破直接引用链',
    '评估是否可拆分为 facade + 实现，或按读写/生命周期阶段分离职责',
  ];
}

function calculateCoupling(dependencies, dependents) {
  const inDegree = dependents?.length || 0;
  const outDegree = dependencies?.length || 0;
  const total = inDegree + outDegree;
  return {
    inDegree,
    outDegree,
    total,
    level: total > SCORING.COUPLING_HIGH_MIN ? 'high' : total > SCORING.COUPLING_MEDIUM_MIN ? 'medium' : 'low',
  };
}

function buildCouplingSplitSuggestions(root, depGraph, mainlineFiles, projectContext) {
  const isSmallProject = mainlineFiles.length < 200;
  const candidates = [];
  for (const file of mainlineFiles) {
    const dependents = depGraph.getDependents?.(file) || [];
    const dependencies = depGraph.getDependencies?.(file) || [];
    const coupling = calculateCoupling(dependencies, dependents);
    const classification = projectContext?.classifyFile?.(file);
    if (!classification?.isMainline) continue;

    const role = classification.fileRole || 'library';
    const isPureUtility = coupling.outDegree === 0 && coupling.inDegree > 0;
    const isScriptOrTest = role === 'script' || role === 'test';
    const isEntry = role === 'entry';
    const isOverCoupled = coupling.level === 'high' ||
      (!isPureUtility && !isScriptOrTest && !isEntry && coupling.total >= DEFAULTS.COUPLING_SPLIT_MIN_TOTAL && (coupling.inDegree >= 2 || coupling.outDegree >= 2));
    if (!isOverCoupled) continue;
    candidates.push({
      file,
      coupling,
      role: classification.fileRole || 'library',
    });
  }

  return candidates
    .sort((a, b) => b.coupling.total - a.coupling.total)
    .slice(0, 3)
    .map((item, index) => ({
      moduleId: `coupling-${index + 1}`,
      file: toRelative(root, item.file),
      coupling: item.coupling,
      role: item.role,
      reason: `耦合过高（in=${item.coupling.inDegree}, out=${item.coupling.outDegree}, total=${item.coupling.total}）`,
      splitPlan: generateCouplingSplitPlan(item.role, item.coupling, isSmallProject),
      validation: {
        command: 'workspace-bridge-cli audit-overview --cwd . --json --quiet',
        expectation: '目标模块 coupling.total 下降，stabilityScore 不回退',
      },
    }));
}

module.exports = {
  buildOverviewSummary,
  buildCycleRefactorSuggestions,
  buildCouplingSplitSuggestions,
  calculateCoupling,
};
