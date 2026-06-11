/**
 * dashboard-formatter.js - L5 HTML 渲染与文件 I/O
 * 负责 overview 相关的可视化输出与磁盘写入。
 */
const path = require('path');
const fs = require('fs');
const { DEFAULTS, SCORING } = require('../../config/constants');
const {
  buildHotspotVisualizationData,
  buildStabilityTrendSnapshot,
  buildStabilityTrendSeries,
  getTrendBucketKey,
} = require('../../tools/overview-assembler');

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Dashboard layout constants — single source of truth for all visual sizing.
const DASHBOARD_LAYOUT = {
  wrapMaxWidth: '1100px',
  wrapPadding: '28px',
  gridMinColumn: '230px',
  gridGap: '12px',
  cardBorderRadius: '12px',
  cardPadding: '14px',
  h1FontSize: '28px',
  h2FontSize: '16px',
  numFontSize: '26px',
  tableFontSize: '13px',
  cellPadding: '8px',
  pillPaddingV: '2px',
  pillPaddingH: '8px',
  pillBorderRadius: '999px',
  pillFontSize: '12px',
  sectionMarginTop: '12px',
};

function renderOverviewDashboard(data) {
  const S = DASHBOARD_LAYOUT;
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
    .wrap{max-width:${S.wrapMaxWidth};margin:0 auto;padding:${S.wrapPadding};}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(${S.gridMinColumn},1fr));gap:${S.gridGap};}
    .card{background:rgba(17,24,39,.85);border:1px solid #334155;border-radius:${S.cardBorderRadius};padding:${S.cardPadding};}
    h1{margin:0 0 ${S.cellPadding};font-size:${S.h1FontSize}}
    h2{margin:0 0 ${S.cellPadding};font-size:${S.h2FontSize};color:var(--muted);font-weight:600}
    .num{font-size:${S.numFontSize};font-weight:700}
    table{width:100%;border-collapse:collapse;font-size:${S.tableFontSize}}
    th,td{padding:${S.cellPadding};border-bottom:1px solid #334155;text-align:left}
    .pill{display:inline-block;padding:${S.pillPaddingV} ${S.pillPaddingH};border-radius:${S.pillBorderRadius};font-size:${S.pillFontSize}}
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
  <div class="card" style="margin-top:${S.sectionMarginTop}">
    <h2>Top Hotspots</h2>
    <table><thead><tr><th>File</th><th>Score</th><th>Risk</th><th>Reason</th></tr></thead><tbody id="hotspots"></tbody></table>
  </div>
  <div class="card" style="margin-top:${S.sectionMarginTop}">
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

async function ensureWriteTextFile(filePath, content) {
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(filePath, content, 'utf8');
}

async function writeHotspotDataFile(filePath, payload) {
  await ensureWriteTextFile(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

async function readTrendHistory(filePath) {
  if (!fs.existsSync(filePath)) return [];
  try {
    const { stripBOM } = require('../../utils/sanitize');
    const content = await fs.promises.readFile(filePath, 'utf8');
    const parsed = JSON.parse(stripBOM(content));
    return Array.isArray(parsed?.history) ? parsed.history : [];
  } catch {
    return [];
  }
}

async function writeStabilityTrendFile(filePath, payload) {
  await ensureWriteTextFile(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

async function writeOverviewDashboardFile(filePath, data) {
  await ensureWriteTextFile(filePath, renderOverviewDashboard(data));
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

module.exports = {
  renderOverviewDashboard,
  writeOverviewDashboardFile,
  writeHotspotDataFile,
  readTrendHistory,
  writeStabilityTrendFile,
  ensureWriteTextFile,
  escapeHtml,
  writeOverviewOutputs,
};
