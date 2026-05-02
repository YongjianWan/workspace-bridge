/**
 * Security audit tool — aggregate external scanner findings.
 */
const { getAvailableAdapters } = require('../adapters');

function groupBySeverity(findings) {
  const map = { high: 0, medium: 0, low: 0, unknown: 0 };
  for (const f of findings) {
    const key = map[f.severity] !== undefined ? f.severity : 'unknown';
    map[key]++;
  }
  return map;
}

function dedupeFindings(findings) {
  const seen = new Set();
  const out = [];
  for (const f of findings) {
    const key = `${f.tool}|${f.ruleId}|${f.file}|${f.lineStart}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

async function auditSecurity({ cwd, targets = [], config }, container) {
  void container;
  const adapters = await getAvailableAdapters(cwd);
  if (adapters.length === 0) {
    return {
      ok: true,
      adapters: [],
      findings: [],
      summary: {
        total: 0,
        bySeverity: { high: 0, medium: 0, low: 0, unknown: 0 },
        message: 'No security scanners available. Install semgrep (pip install semgrep) or codeql.',
      },
    };
  }

  const allFindings = [];
  const scanMeta = [];
  for (const adapter of adapters) {
    const result = await adapter.scan(targets, { cwd, config });
    scanMeta.push({ name: adapter.name, summary: result.summary });
    allFindings.push(...result.findings);
  }

  const deduped = dedupeFindings(allFindings);
  const bySeverity = groupBySeverity(deduped);

  return {
    ok: true,
    adapters: adapters.map((a) => a.name),
    findings: deduped,
    scanMeta,
    summary: {
      total: deduped.length,
      bySeverity,
      message: null,
    },
  };
}

module.exports = { auditSecurity, groupBySeverity, dedupeFindings };
