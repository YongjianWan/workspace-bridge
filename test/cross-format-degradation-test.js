#!/usr/bin/env node
// @fast
// @contract
// H-39：降级信号（warnings / dataQuality）必须在 json、ai、jsonl、markdown 四种格式下
// 都能读到，且截断说明写实际列出的行数。agent 首选 --format ai（SKILL.md），
// 首选格式丢降级信号 = agent 把降级结果读成满分置信（AGENTS L1-4）。
const assert = require('assert');
const { formatAi, formatJsonl, formatMarkdown, formatSummary } = require('../src/cli/formatters/human-formatters');
const { CONFIDENCE } = require('../src/config/constants');

const WARNING = { type: 'dynamic-load-unresolved', severity: 'medium', message: '9 file(s) contain module loads whose runtime targets could not be determined' };

// 15 行列表、impactCount 535：summary 实际列 5 行（OUTPUT_MEDIUM），markdown 列 10 行（OUTPUT_LONG）
function degradedImpactResult() {
  return {
    ok: true,
    impactCount: 535,
    impact: Array.from({ length: 15 }, (_, i) => ({ file: `/repo/src/f${i}.js`, level: 1 })),
    truncated: true,
    dataQuality: 'degraded',
    warnings: [WARNING],
  };
}

// --- ai：warnings + dataQuality 透传，degraded 压低 confidence，截断写实际行数 ---
{
  const ai = JSON.parse(formatAi('impact', degradedImpactResult()));
  assert(Array.isArray(ai.warnings) && ai.warnings.length === 1, 'ai must carry warnings');
  assert.strictEqual(ai.dataQuality, 'degraded', 'ai must carry dataQuality');
  assert(ai.confidence.overall <= CONFIDENCE.LOW_VALUE, `degraded input must lower confidence.overall (got ${ai.confidence.overall})`);
  assert(ai.summary.includes('showing 5 of 535'), `ai-embedded summary must state the actual listed count (got: ${JSON.stringify(ai.summary)})`);
}

// --- ai surface 深度也不能丢降级信号 ---
{
  const surface = JSON.parse(formatAi('impact', degradedImpactResult(), { depth: 'surface' }));
  assert.strictEqual(surface.dataQuality, 'degraded', 'surface depth must carry dataQuality');
  assert(Array.isArray(surface.warnings) && surface.warnings.length === 1, 'surface depth must carry warnings');
}

// --- jsonl：warning 用独立 _type 记录，dataQuality 可读 ---
{
  const lines = formatJsonl('impact', degradedImpactResult()).split('\n').filter(Boolean).map(JSON.parse);
  const warningRecs = lines.filter((r) => r._type === 'warning');
  assert.strictEqual(warningRecs.length, 1, 'jsonl must emit exactly one warning record');
  assert.strictEqual(warningRecs[0].type, WARNING.type, 'jsonl warning record keeps the warning type');
  const qualityRec = lines.find((r) => r._type === 'data-quality');
  assert(qualityRec && qualityRec.dataQuality === 'degraded', 'jsonl must emit a data-quality record');
}

// --- markdown：降级信号可见，截断写实际行数 ---
{
  const md = formatMarkdown('impact', degradedImpactResult());
  assert(md.includes('degraded'), 'markdown must mention degraded dataQuality');
  assert(md.includes(WARNING.message), 'markdown must list the warning message');
  assert(md.includes('showing 10 of 535'), `markdown must state the actual listed count (got truncated line: ${md.split('\n').filter((l) => l.includes('truncated'))})`);
}

// --- 干净结果：三种格式都不产生降级噪音 ---
{
  const clean = { ok: true, impactCount: 1, impact: [{ file: '/repo/a.js', level: 1 }], truncated: false, dataQuality: 'certain', warnings: [] };
  const ai = JSON.parse(formatAi('impact', clean));
  assert.strictEqual(ai.confidence.overall, 1.0, 'certain input keeps full confidence');
  assert(!('warnings' in ai), 'clean ai output must not grow an empty warnings field');
  const jsonlLines = formatJsonl('impact', clean).split('\n').filter(Boolean).map(JSON.parse);
  assert(!jsonlLines.some((r) => r._type === 'warning' || r._type === 'data-quality'), 'clean jsonl must not emit degradation records');
  const md = formatMarkdown('impact', clean);
  assert(!md.includes('## Warnings') && !md.includes('## Data Quality'), 'clean markdown must not grow degradation sections');
}

// --- 无 dataQuality 字段但有 warnings：只发 warning，不虚构 certain ---
{
  const noQuality = { ok: true, impactCount: 1, impact: [{ file: '/repo/a.js', level: 1 }], warnings: [WARNING] };
  const lines = formatJsonl('impact', noQuality).split('\n').filter(Boolean).map(JSON.parse);
  assert(lines.some((r) => r._type === 'warning'), 'warnings still emitted without dataQuality');
  assert(!lines.some((r) => r._type === 'data-quality'), 'no dataQuality field must not fabricate a certain record');
  const md = formatMarkdown('impact', noQuality);
  assert(md.includes('## Warnings'), 'markdown lists warnings without dataQuality field');
  assert(!md.includes('## Data Quality'), 'markdown must not fabricate a Data Quality section');
}

// --- api-contracts：jsonl/markdown 的 warning 只出现一次（收发口统一，不重复） ---
{
  const result = {
    ok: true,
    clientCallsCount: 1,
    serverRoutesCount: 1,
    matchedCount: 0,
    unmatchedClientCount: 1,
    unmatchedServerCount: 1,
    coverageRatio: 0,
    matched: [],
    unmatchedClient: [{ method: 'GET', path: '/api/x', files: ['a.ts'] }],
    unmatchedServer: [{ method: 'GET', path: '/api/y', files: ['b.js'] }],
    warnings: [{ reason: 'dynamic-url-skipped', message: 'Template-literal URLs with interpolation are not statically extractable', file: 'a.ts' }],
  };
  const lines = formatJsonl('api-contracts', result).split('\n').filter(Boolean).map(JSON.parse);
  const warningRecs = lines.filter((r) => r._type === 'warning');
  assert.strictEqual(warningRecs.length, 1, `api-contracts jsonl must emit each warning exactly once (got ${warningRecs.length})`);
  const md = formatMarkdown('api-contracts', result);
  const mdWarningSections = md.split('\n').filter((l) => l.startsWith('## Warnings'));
  assert.strictEqual(mdWarningSections.length, 1, `api-contracts markdown must have exactly one Warnings section (got ${mdWarningSections.length})`);
}

// --- audit-summary ai：dataQuality 透传 + degraded 压低 confidence ---
{
  const result = {
    ok: true,
    workspaceRoot: '/project',
    scope: { counts: { totalFiles: 10, mainlineFiles: 6, nonMainlineFiles: 4 } },
    summary: { severity: 'medium', analysisCoverage: { totalFiles: 10, parsedFiles: 10, coverageRatio: 1 } },
    health: { healthScore: '5/5', healthScoreNumeric: { ratio: 1 } },
    deadExports: { deadExportsCount: 0 },
    unresolved: { unresolvedCount: 0 },
    cycles: { cyclesCount: 0 },
    dataQuality: 'degraded',
    warnings: [WARNING],
  };
  const ai = JSON.parse(formatAi('audit-summary', result));
  assert.strictEqual(ai.dataQuality, 'degraded', 'audit-summary ai must carry dataQuality');
  assert(Array.isArray(ai.warnings) && ai.warnings.length === 1, 'audit-summary ai must carry warnings');
  assert(ai.confidence.overall <= CONFIDENCE.LOW_VALUE, `degraded audit-summary must lower confidence.overall (got ${ai.confidence.overall})`);
}

// --- summary 格式自身：截断写实际列出的行数（ai 内嵌引用同一份实现） ---
{
  const summary = formatSummary('impact', degradedImpactResult());
  assert(summary.includes('showing 5 of 535'), `summary must state the actual listed count (got: ${JSON.stringify(summary)})`);
  const mdTen = formatMarkdown('impact', degradedImpactResult());
  const mdLines = mdTen.split('\n');
  const truncIdx = mdLines.findIndex((l) => l.includes('truncated'));
  const listedTen = mdLines.slice(0, truncIdx).filter((l) => l.startsWith('- ') && l.includes('.js')).length;
  assert.strictEqual(listedTen, 10, `markdown must list 10 rows before the truncation note (got ${listedTen})`);
}

console.log('cross-format-degradation-test: OK');
