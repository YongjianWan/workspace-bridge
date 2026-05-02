/**
 * Project Overview - Milestone 5: 全景视图
 * 整合 dep-graph、project-context、git 历史，生成工程上帝视角
 */
const path = require('path');
const fs = require('fs');
const { getFileHistoryRisk } = require('./git-tools');
const { overviewSeverity } = require('../config/risk-thresholds');
const { toRelativePosix } = require('../utils/path');
const { DEFAULTS } = require('../config/constants');

function toRelative(root, filePath) {
  return toRelativePosix(root, filePath);
}

const HOTSPOT_SCORE_RULES = [
  { field: 'commitCount', alt: 'churn', cap: 10, weight: 2 },
  { field: 'authorCount', fallback: 1, weight: 3 },
  { field: 'lastModifiedDaysAgo', condition: (v) => v !== undefined && v !== null, transform: (v) => Math.max(0, 30 - v) * 0.5 },
  { field: 'revertLikeCount', fallback: 0, weight: 5 },
];

function calculateHotspotScore(historyRisk) {
  if (!historyRisk) return 0;

  let score = 0;
  for (const rule of HOTSPOT_SCORE_RULES) {
    let value = historyRisk[rule.field];
    if (value === undefined && rule.alt) value = historyRisk[rule.alt];
    if (value === undefined || value === null) value = rule.fallback || 0;
    if (rule.condition && !rule.condition(value)) continue;
    if (rule.cap !== undefined) value = Math.min(value, rule.cap);
    if (rule.transform) {
      score += rule.transform(value);
    } else {
      score += value * rule.weight;
    }
  }
  return Math.min(Math.round(score), 100);
}

const STABILITY_SCORE_RULES = [
  { check: (ctx) => ctx.hasTests, delta: 20 },
  { check: (ctx) => ctx.impactCount < 5, delta: 10 },
  { check: (ctx) => ctx.impactCount > 20, delta: -10 },
  { check: (ctx) => !ctx.classification?.isMainline, delta: -10 },
  { check: (ctx) => ctx.inCycle, delta: -15 },
  { check: (ctx) => ctx.classification?.fileRole === 'config', delta: 10 },
];

function calculateStabilityScore(classification, impactCount, hasTests, inCycle) {
  let score = 50;
  const ctx = { classification, impactCount, hasTests, inCycle };
  for (const rule of STABILITY_SCORE_RULES) {
    if (rule.check(ctx)) score += rule.delta;
  }
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
    } else if (
      relativePath.startsWith('scripts/') || relativePath.includes('/scripts/') ||
      relativePath.startsWith('bin/') || relativePath.includes('/bin/') ||
      relativePath.startsWith('benchmark/') || relativePath.includes('/benchmark/') ||
      relativePath.startsWith('wb-analysis-fixture/') || relativePath.includes('/wb-analysis-fixture/')
    ) {
      continue; // Scripts, benchmarks, and test fixtures are standalone entry points, not orphans
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
    console.error(`[overview] Failed to get history for ${filePath}:`, e.message);
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
    mainlineFiles.slice(0, DEFAULTS.HOTSPOT_CANDIDATE_LIMIT).map(async (file) => {
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

  for (const file of mainlineFiles.slice(0, DEFAULTS.STABILITY_CANDIDATE_LIMIT)) {
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
  }
  summary.severity = overviewSeverity({ fragileModuleCount: fragileModules.length });

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

function generateCouplingSplitPlan(role, coupling) {
  const { inDegree, outDegree, total } = coupling;

  // Entry point: high outward coupling is natural, focus on command dispatch
  if (role === 'entry') {
    return [
      'entry 点天然需要聚合依赖，关注是否可提取子命令分发层',
      '避免在 entry 中直接包含业务实现，将具体逻辑下沉到独立服务',
    ];
  }

  // Pure utility (only depended upon, no dependencies)
  if (inDegree > 0 && outDegree === 0) {
    return [
      '被大量模块依赖，修改影响面大，建议保持接口稳定，新增功能优先开新模块',
      '保持原子性，避免吸收不相关职责；若规模膨胀再按主题拆分',
    ];
  }

  // Pure consumer (only depends on others, no dependents)
  if (inDegree === 0 && outDegree > 0) {
    return [
      '零被依赖但高 outward 耦合，检查是否有重复初始化逻辑可下沉为独立模块',
      '评估是否可通过依赖注入或工厂模式减少直接引用数量',
    ];
  }

  // Script / tool modules
  if (role === 'script') {
    return [
      '工具模块被多处引用，提取可复用核心逻辑到独立库，避免业务状态沉淀',
      '保持工具函数无副作用，按领域拆分为专用工具子模块',
    ];
  }

  // Test files
  if (role === 'test') {
    return [
      '测试文件耦合高通常正常，关注是否可提取公共测试 fixture 到独立 helper',
      '避免测试间相互 import，保持测试隔离性',
    ];
  }

  // Config files
  if (role === 'config') {
    return [
      '配置模块被多处引用时，考虑按环境或领域拆分为独立配置文件',
      '提取配置验证逻辑到独立模块，避免配置解析散落在各处',
    ];
  }

  // Default: bidirectional coupling (both depended upon and depends on others)
  return [
    '同时被依赖和依赖他人，考虑提取接口层或 facade 打破直接引用链',
    '评估是否可拆分为 facade + 实现，或按读写/生命周期阶段分离职责',
  ];
}

function buildCouplingSplitSuggestions(root, depGraph, mainlineFiles, projectContext) {
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
    .slice(0, 10)
    .map((item, index) => ({
      moduleId: `coupling-${index + 1}`,
      file: toRelative(root, item.file),
      coupling: item.coupling,
      role: item.role,
      reason: `耦合过高（in=${item.coupling.inDegree}, out=${item.coupling.outDegree}, total=${item.coupling.total}）`,
      splitPlan: generateCouplingSplitPlan(item.role, item.coupling),
      validation: {
        command: 'node cli.js audit-overview --cwd . --json --quiet',
        expectation: '目标模块 coupling.total 下降，stabilityScore 不回退',
      },
    }));
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
  const content = await fs.promises.readFile(filePath, 'utf8');
  const parsed = JSON.parse(content);
  return Array.isArray(parsed?.history) ? parsed.history : [];
}

async function writeStabilityTrendFile(filePath, payload) {
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderOverviewDashboard(data) {
  const payload = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>workspace-bridge overview</title>
  <style>
    :root{--bg:#0f172a;--panel:#111827;--fg:#e5e7eb;--muted:#94a3b8;--ok:#22c55e;--warn:#eab308;--bad:#ef4444;}
    body{margin:0;font-family:"IBM Plex Sans","Segoe UI",sans-serif;background:radial-gradient(circle at top,#1e293b,#0f172a 60%);color:var(--fg);}
    .wrap{max-width:1100px;margin:0 auto;padding:28px;}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px;}
    .card{background:rgba(17,24,39,.85);border:1px solid #334155;border-radius:12px;padding:14px;}
    h1{margin:0 0 8px;font-size:28px}
    h2{margin:0 0 8px;font-size:16px;color:var(--muted);font-weight:600}
    .num{font-size:26px;font-weight:700}
    table{width:100%;border-collapse:collapse;font-size:13px}
    th,td{padding:8px;border-bottom:1px solid #334155;text-align:left}
    .pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px}
    .high{background:rgba(239,68,68,.2);color:#fecaca}.medium{background:rgba(234,179,8,.2);color:#fde68a}.low{background:rgba(34,197,94,.2);color:#bbf7d0}
  </style>
</head>
<body>
<div class="wrap">
  <h1>Workspace Overview Dashboard</h1>
  <div class="grid">
    <div class="card"><h2>Workspace</h2><div>${escapeHtml(data.workspaceRoot)}</div></div>
    <div class="card"><h2>Severity</h2><div class="num">${escapeHtml(data.summary?.severity || 'low')}</div></div>
    <div class="card"><h2>Mainline Files</h2><div class="num">${Number(data.skeleton?.mainlineFiles || 0)}</div></div>
    <div class="card"><h2>Fragile Modules</h2><div class="num">${Number(data.aggregates?.stabilityCounts?.fragile || 0)}</div></div>
  </div>
  <div class="card" style="margin-top:12px">
    <h2>Top Hotspots</h2>
    <table><thead><tr><th>File</th><th>Score</th><th>Risk</th><th>Reason</th></tr></thead><tbody id="hotspots"></tbody></table>
  </div>
  <div class="card" style="margin-top:12px">
    <h2>Coupling Split Suggestions</h2>
    <table><thead><tr><th>File</th><th>Total</th><th>Reason</th></tr></thead><tbody id="coupling"></tbody></table>
  </div>
</div>
<script>
const DATA = ${payload};
function row(cells){const tr=document.createElement('tr');cells.forEach(c=>{const td=document.createElement('td');if(c&&c.nodeType){td.appendChild(c);}else{td.textContent=String(c??'');}tr.appendChild(td);});return tr;}
const hotspotBody=document.getElementById('hotspots');
(DATA.hotspots||[]).slice(0,10).forEach(item=>{const risk=document.createElement('span');risk.className='pill '+(item.risk||'low');risk.textContent=item.risk||'low';hotspotBody.appendChild(row([item.file,item.score,risk,item.reason]));});
const couplingBody=document.getElementById('coupling');
(((DATA.architectureAdvice||{}).couplingSplitSuggestions)||[]).slice(0,10).forEach(item=>{couplingBody.appendChild(row([item.file,item.coupling?.total||0,item.reason]));});
</script>
</body>
</html>`;
}

async function writeOverviewDashboardFile(filePath, data) {
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });
  const html = renderOverviewDashboard(data);
  await fs.promises.writeFile(filePath, html, 'utf8');
}

function buildLanguageSupportMatrix(depGraph) {
  const matrix = {};
  const stats = {};
  for (const [filePath, info] of depGraph.graph || []) {
    const ext = path.extname(filePath).toLowerCase();
    let lang = null;
    if (['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'].includes(ext)) lang = 'javascript';
    else if (ext === '.py') lang = 'python';
    else if (ext === '.java') lang = 'java';
    else if (ext === '.kt') lang = 'kotlin';
    else if (ext === '.go') lang = 'go';
    else if (ext === '.rs') lang = 'rust';
    if (!lang) continue;
    if (!stats[lang]) stats[lang] = { total: 0, ast: 0 };
    stats[lang].total++;
    if (info.parseMode === 'ast') stats[lang].ast++;
  }
  for (const [lang, s] of Object.entries(stats)) {
    const ratio = s.total > 0 ? s.ast / s.total : 0;
    matrix[lang] = {
      level: ratio >= 0.5 ? 'ast' : 'regex',
      confidence: ratio >= 0.8 ? 'high' : ratio >= 0.5 ? 'medium' : 'low',
      files: s.total,
      astFiles: s.ast,
    };
  }
  return matrix;
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
  const couplingSplitSuggestions = buildCouplingSplitSuggestions(root, depGraph, mainlineFiles, projectContext);
  if (cycleRefactorSuggestions.length > 0) {
    summary.recommendations.push(`先处理循环依赖: ${cycleRefactorSuggestions.slice(0, 2).map((item) => item.breakCandidate.from).join(', ')}`);
  }
  if (couplingSplitSuggestions.length > 0) {
    summary.recommendations.push(`高耦合模块拆分优先级: ${couplingSplitSuggestions.slice(0, 2).map((item) => item.file).join(', ')}`);
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

  let overviewDashboardFile = null;
  if (args?.overviewDashboard) {
    const target = path.isAbsolute(args.overviewDashboard)
      ? args.overviewDashboard
      : path.resolve(root, args.overviewDashboard);
    const dashboardData = {
      workspaceRoot: root,
      summary,
      aggregates,
      skeleton,
      hotspots: hotspots.slice(0, 10),
      architectureAdvice: {
        cycleRefactorSuggestions,
        couplingSplitSuggestions,
      },
    };
    await writeOverviewDashboardFile(target, dashboardData);
    overviewDashboardFile = target;
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
      overviewDashboard: {
        enabled: Boolean(args?.overviewDashboard),
        path: args?.overviewDashboard || null,
      },
    },
    summary,
    aggregates,
    skeleton,
    hotspots: hotspots.slice(0, 10),
    architectureAdvice: {
      cycleRefactorSuggestions,
      couplingSplitSuggestions,
    },
    hotspotData,
    hotspotDataFile,
    stabilityTrend,
    stabilityTrendDataFile,
    overviewDashboardFile,
    stability: stability.slice(0, 10),
    languageSupport: buildLanguageSupportMatrix(depGraph),
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
  renderOverviewDashboard,
  buildLanguageSupportMatrix,
};
