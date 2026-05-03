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

/**
 * Drop exact-match duplicates within the same tool's results.
 * Cross-tool findings at the same location are intentionally kept —
 * Semgrep + CodeQL flagging the same line is a confirmation signal,
 * not noise.
 */
function dedupeWithinTool(findings) {
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

async function auditSecurity({ cwd, targets = [], config, language, dbPath, forceRefresh }, container) {
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

  // Default to scanning the workspace root when user gave no targets —
  // matches what `node cli.js audit-security` intuitively means.
  const effectiveTargets = targets.length > 0 ? targets : ['.'];

  const results = await Promise.all(
    adapters.map((adapter) => adapter.scan(effectiveTargets, { cwd, config, language, dbPath, forceRefresh }))
  );
  const scanMeta = adapters.map((a, i) => ({ name: a.name, summary: results[i].summary }));
  const allFindings = results.flatMap((r) => r.findings);

  const deduped = dedupeWithinTool(allFindings);
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

module.exports = { auditSecurity, groupBySeverity, dedupeWithinTool };
