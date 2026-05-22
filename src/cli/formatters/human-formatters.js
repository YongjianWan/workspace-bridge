/**
 * Human-readable formatters for CLI commands.
 * Registry-based dispatch — no more switch-case chains.
 */
const { countTreeFiles } = require('./project-map');
const { AI_FORMAT } = require('../../config/constants');
const { sanitizeForAiOutput } = require('../../utils/sanitize');

/**
 * Shared audit-summary formatter across text output styles.
 */
function formatAuditSummary(result, style) {
  switch (style) {
    case 'markdown': {
      const lines = [
        `# Audit Summary`,
        ``,
        `- **Severity**: ${result.summary?.severity}`,
        `- **Health**: ${result.health?.healthScore}`,
        `- **Files**: ${result.scope?.counts?.totalFiles ?? 0} total, ${result.scope?.counts?.mainlineFiles ?? 0} mainline`,
        `- **Issues**: ${result.deadExports?.deadExportsCount ?? 0} dead exports, ${result.unresolved?.unresolvedCount ?? 0} unresolved, ${result.cycles?.cyclesCount ?? 0} cycles`,
      ];
      const cov = result.summary?.analysisCoverage;
      if (cov) {
        lines.push(`- **Coverage**: ${cov.parsedFiles}/${cov.totalFiles} parsed (${Math.round(cov.coverageRatio * 100)}%)`);
      }
      if (result.summary?.nextSteps?.length) {
        lines.push('', `## Next Steps`);
        for (const step of result.summary.nextSteps.slice(0, 3)) {
          lines.push(`- ${step}`);
        }
      }
      return lines.join('\n');
    }
    case 'summary': {
      const lines = [
        `Severity: ${result.summary?.severity}`,
        `Health: ${result.health?.healthScore}`,
        `Files: ${result.scope?.counts?.totalFiles ?? 0} total, ${result.scope?.counts?.mainlineFiles ?? 0} mainline`,
        `Issues: ${result.deadExports?.deadExportsCount ?? 0} dead exports, ${result.unresolved?.unresolvedCount ?? 0} unresolved, ${result.cycles?.cyclesCount ?? 0} cycles`,
      ];
      const cov = result.summary?.analysisCoverage;
      if (cov) {
        lines.push(`Coverage: ${cov.parsedFiles}/${cov.totalFiles} parsed (${Math.round(cov.coverageRatio * 100)}%)`);
      }
      if (result.summary?.nextSteps?.length) {
        lines.push('Next steps:');
        for (const step of result.summary.nextSteps.slice(0, 3)) {
          lines.push(`  • ${step}`);
        }
      }
      return lines.join('\n');
    }
    case 'human': {
      if (!result.summary || typeof result.summary !== 'object') {
        return `Error: malformed audit-summary result (missing summary)`;
      }
      const lines = [
        `workspaceRoot: ${result.workspaceRoot}`,
        `severity: ${result.summary.severity}`,
        `healthScore: ${result.health.healthScore}`,
        `totalFiles: ${result.scope.counts.totalFiles} (parseable source only; excludes assets/build artifacts/excluded dirs)`,
        `mainlineFiles: ${result.scope.counts.mainlineFiles}`,
        `nonMainlineFiles: ${result.scope.counts.nonMainlineFiles}`,
        `deadExportsCount: ${result.deadExports.deadExportsCount}`,
        `unresolvedCount: ${result.unresolved.unresolvedCount}`,
        `cyclesCount: ${result.cycles.cyclesCount}`,
      ];
      if (result.summary.honesty?.disclaimer) {
        lines.push(`note: ${result.summary.honesty.disclaimer}`);
      }
      return lines.join('\n');
    }
    default:
      return '';
  }
}

function buildSecurityLines(result, style) {
  const isMd = style === 'markdown';
  const isSum = style === 'summary';
  const max = isMd ? 10 : isSum ? 5 : 20;
  const bp = isMd ? '- ' : (isSum ? '  ' : '');
  const bold = (t) => isMd ? `**${t}**` : t;
  const sep = ': ';
  const labels = isMd || isSum ? ['Adapters', 'Findings', 'Severity'] : ['adapters', 'findings', 'severity'];
  const lines = [];
  lines.push(`${bp}${bold(labels[0])}${sep}${result.adapters?.join(', ') || 'none'}`);
  lines.push(`${bp}${bold(labels[1])}${sep}${result.summary?.total ?? 0}`);
  lines.push(`${bp}${bold(labels[2])}${sep}high=${result.summary?.bySeverity?.high ?? 0} medium=${result.summary?.bySeverity?.medium ?? 0} low=${result.summary?.bySeverity?.low ?? 0}`);
  if (result.findings?.length > 0) {
    if (isMd) lines.push('', '## Findings');
    else if (isSum) lines.push('Top findings:');
    else lines.push('');
    for (const f of result.findings.slice(0, max)) {
      lines.push(isMd
        ? `- **[${f.severity.toUpperCase()}] \`${f.ruleId}\` — ${f.file}${f.lineStart ? ':' + f.lineStart : ''}`
        : `${bp}[${f.severity.toUpperCase()}] ${f.ruleId} — ${f.file}${f.lineStart ? ':' + f.lineStart : ''}`
      );
      if (f.message && !isSum) lines.push(isMd ? `  - ${f.message}` : `  ${f.message}`);
      if (f.matchedText) {
        const m = `Matched: \`${sanitizeForAiOutput(f.matchedText, 120)}\``;
        lines.push(isMd ? `  - ${m}` : (isSum ? `    ${m}` : `  ${m}`));
      }
    }
    if (result.findings.length > max) {
      const more = `... and ${result.findings.length - max} more`;
      lines.push(isMd ? `- *${more}*` : `${bp}${more}`);
    }
  }
  return lines;
}

// ---------------------------------------------------------------------------
// FORMATTER REGISTRY — command × style lookup table
// ---------------------------------------------------------------------------
const FORMATTERS = {
  'audit-summary': {
    human: (r) => formatAuditSummary(r, 'human'),
    summary: (r) => formatAuditSummary(r, 'summary'),
    markdown: (r) => formatAuditSummary(r, 'markdown'),
    jsonl: (r) => {
      const rec = [];
      const push = (type, arr) => { if (Array.isArray(arr)) for (const item of arr) rec.push(item && typeof item === 'object' ? { _type: type, ...item } : { _type: type, value: item }); };
      push('dead-export', r.deadExports?.deadExports);
      push('unresolved', r.unresolved?.unresolved);
      push('cycle', r.cycles?.cycles);
      if (rec.length === 0) rec.push({ _type: 'summary', ok: r.ok, command: 'audit-summary', severity: r.summary?.severity });
      return rec.map(JSON.stringify).join('\n');
    },
  },
  'audit-overview': {
    human: (r) => {
      const ls = Object.entries(r.languageSupport || {}).map(([l, i]) => `${l}(${i.level}/${i.confidence})`).join(', ') || 'none';
      return [
        `workspaceRoot: ${r.workspaceRoot}`,
        `severity: ${r.summary?.severity || 'low'}`,
        `totalFiles: ${r.skeleton?.totalFiles ?? 0} (parseable source only; excludes assets/build artifacts/excluded dirs)`,
        `mainlineFiles: ${r.skeleton?.mainlineFiles ?? 0}`,
        `hotspotsHigh: ${r.aggregates?.hotspotsByRisk?.high ?? 0}`,
        `hotspotsMedium: ${r.aggregates?.hotspotsByRisk?.medium ?? 0}`,
        `fragileModules: ${r.aggregates?.stabilityCounts?.fragile ?? 0}`,
        `orphansTotal: ${r.orphans?.counts?.total ?? 0}`,
        `languages: ${ls}`,
      ].join('\n');
    },
    summary: (r) => {
      const agg = r.aggregates || {};
      const ls = Object.entries(r.languageSupport || {}).map(([l, i]) => `${l}(${i.level}/${i.confidence})`).join(', ') || 'none';
      const lines = [
        `Severity: ${r.summary?.severity || 'low'}`,
        `Files: ${r.skeleton?.totalFiles ?? 0} total, ${r.skeleton?.mainlineFiles ?? 0} mainline`,
        `Hotspots: ${agg.hotspotsByRisk?.high ?? 0} high, ${agg.hotspotsByRisk?.medium ?? 0} medium`,
        `Fragile modules: ${agg.stabilityCounts?.fragile ?? 0}`,
        `Orphans: ${r.orphans?.counts?.total ?? 0}`,
        `Languages: ${ls}`,
      ];
      if (r.summary?.recommendations?.length) { lines.push('Recommendations:'); for (const rec of r.summary.recommendations.slice(0, 2)) lines.push(`  • ${rec}`); }
      return lines.join('\n');
    },
    markdown: (r) => {
      const agg = r.aggregates || {};
      const ls = Object.entries(r.languageSupport || {}).map(([l, i]) => `${l}(${i.level}/${i.confidence})`).join(', ') || 'none';
      const lines = [
        `# Project Overview`,
        ``,
        `- **Severity**: ${r.summary?.severity || 'low'}`,
        `- **Files**: ${r.skeleton?.totalFiles ?? 0} total, ${r.skeleton?.mainlineFiles ?? 0} mainline`,
        `- **Hotspots**: ${agg.hotspotsByRisk?.high ?? 0} high, ${agg.hotspotsByRisk?.medium ?? 0} medium`,
        `- **Fragile modules**: ${agg.stabilityCounts?.fragile ?? 0}`,
        `- **Orphans**: ${r.orphans?.counts?.total ?? 0}`,
        `- **Languages**: ${ls}`,
      ];
      if (r.summary?.recommendations?.length) { lines.push(``, `## Recommendations`); for (const rec of r.summary.recommendations.slice(0, 3)) lines.push(`- ${rec}`); }
      return lines.join('\n');
    },
    jsonl: (r) => {
      const rec = [];
      const push = (type, arr) => { if (Array.isArray(arr)) for (const item of arr) rec.push(item && typeof item === 'object' ? { _type: type, ...item } : { _type: type, value: item }); };
      push('hotspot', r.hotspots);
      push('stability', r.stability);
      push('orphan', r.orphans?.samples?.modules);
      if (rec.length === 0) rec.push({ _type: 'summary', ok: r.ok, command: 'audit-overview', severity: r.summary?.severity });
      return rec.map(JSON.stringify).join('\n');
    },
  },
  'audit-security': {
    human: (r) => r.summary?.message ? r.summary.message : buildSecurityLines(r, 'human').join('\n'),
    summary: (r) => buildSecurityLines(r, 'summary').join('\n'),
    markdown: (r) => ['# Security Audit', '', ...buildSecurityLines(r, 'markdown')].join('\n'),
    jsonl: (r) => {
      const rec = [];
      const push = (type, arr) => { if (Array.isArray(arr)) for (const item of arr) rec.push(item && typeof item === 'object' ? { _type: type, ...item } : { _type: type, value: item }); };
      push('finding', r.findings);
      if (rec.length === 0) rec.push({ _type: 'summary', ok: r.ok, command: 'audit-security', severity: r.severity || r.summary?.severity });
      return rec.map(JSON.stringify).join('\n');
    },
  },
  'audit-diff': {
    human: (r) => {
      const topRisk = Array.isArray(r.changedFiles) ? r.changedFiles.filter((e) => e?.compositeRisk).sort((a, b) => (b.compositeRisk.score || 0) - (a.compositeRisk.score || 0))[0] : null;
      const topRiskAction = Array.isArray(r.validationAdvice?.topRiskActions) ? r.validationAdvice.topRiskActions[0] : null;
      const lines = [
        `workspaceRoot: ${r.workspaceRoot}`,
        `severity: ${r.summary.severity}`,
        `changedFiles: ${r.summary.counts.changedFiles}`,
        `mainlineChangedFiles: ${r.summary.counts.mainlineChangedFiles}`,
        `affectedTests: ${r.summary.counts.affectedTests}`,
        `maxImpact: ${r.summary.counts.maxImpact}`,
        `highHistoryRiskFiles: ${r.summary.counts.highHistoryRiskFiles}`,
        `highCompositeRiskFiles: ${r.summary.counts.highCompositeRiskFiles}`,
        `fileTypeBreakdown: ${JSON.stringify(r.summary.fileTypeBreakdown)}`,
        `changeMetrics: ${r.summary.changeMetrics ? `+${r.summary.changeMetrics.totalAdditions}/-${r.summary.changeMetrics.totalDeletions}` : 'unavailable'}`,
        `topCompositeRisk: ${topRisk ? `${topRisk.file} (score=${topRisk.compositeRisk.score}, level=${topRisk.compositeRisk.level})` : 'none'}`,
        `topRiskAction: ${topRiskAction ? `${topRiskAction.file}: ${topRiskAction.actions[0]}` : 'none'}`,
        `topRiskCommand: ${topRiskAction?.suggestedCommand || 'none'}`,
        `validationPhases: ${r.validationAdvice.phases.length}`,
      ];
      if (r.incremental && r.incrementalFindings) {
        const inc = r.incrementalFindings;
        lines.push('', '--- incremental findings (related to changed files) ---', `deadExports: ${inc.deadExportsCount}`, `unresolved: ${inc.unresolvedCount}`, `cycles: ${inc.cyclesCount}`);
        for (const de of inc.deadExports.slice(0, 3)) lines.push(`  dead-export: ${de.file}: ${(de.exports || []).map((e) => sanitizeForAiOutput(e)).join(', ') || 'n/a'}`);
        for (const u of inc.unresolved.slice(0, 3)) lines.push(`  unresolved: ${u.file}: ${u.import}`);
        for (const c of inc.cycles.slice(0, 3)) lines.push(`  cycle: ${c.join(' -> ')}`);
        if (inc.deadExportsCount + inc.unresolvedCount + inc.cyclesCount === 0) lines.push('  (none)');
      }
      return lines.join('\n');
    },
    summary: (r) => {
      const lines = [
        `Severity: ${r.summary?.severity}`,
        `Changed files: ${r.summary?.counts?.changedFiles ?? 0}`,
        `Mainline changed: ${r.summary?.counts?.mainlineChangedFiles ?? 0}`,
        `Affected tests: ${r.summary?.counts?.affectedTests ?? 0}`,
        `High composite risk: ${r.summary?.counts?.highCompositeRiskFiles ?? 0}`,
      ];
      if (r.validationAdvice?.phases?.length) lines.push(`Validation phases: ${r.validationAdvice.phases.length}`);
      if (r.incremental && r.incrementalFindings) {
        const inc = r.incrementalFindings;
        lines.push(`Incremental: dead=${inc.deadExportsCount} unresolved=${inc.unresolvedCount} cycles=${inc.cyclesCount}`);
        for (const de of inc.deadExports.slice(0, 3)) lines.push(`  dead-export: ${de.file}`);
        for (const u of inc.unresolved.slice(0, 3)) lines.push(`  unresolved: ${u.file}`);
        for (const c of inc.cycles.slice(0, 3)) lines.push(`  cycle: ${c.join(' -> ')}`);
      }
      return lines.join('\n');
    },
    markdown: (r) => {
      const lines = [
        `# Diff Audit`,
        ``,
        `- **Severity**: ${r.summary?.severity}`,
        `- **Changed files**: ${r.summary?.counts?.changedFiles ?? 0}`,
        `- **Mainline changed**: ${r.summary?.counts?.mainlineChangedFiles ?? 0}`,
        `- **Affected tests**: ${r.summary?.counts?.affectedTests ?? 0}`,
      ];
      if (r.validationAdvice?.phases?.length) lines.push(`- **Validation phases**: ${r.validationAdvice.phases.length}`);
      if (r.incremental && r.incrementalFindings) {
        const inc = r.incrementalFindings;
        lines.push(``, `## Incremental Findings`, `- **Dead exports**: ${inc.deadExportsCount}`, `- **Unresolved**: ${inc.unresolvedCount}`, `- **Cycles**: ${inc.cyclesCount}`);
        for (const de of inc.deadExports.slice(0, 3)) lines.push(`  - \`${de.file}\`: ${(de.exports || []).map((e) => sanitizeForAiOutput(e)).join(', ') || 'n/a'}`);
        for (const u of inc.unresolved.slice(0, 3)) lines.push(`  - \`${u.file}\`: ${u.import}`);
        for (const c of inc.cycles.slice(0, 3)) lines.push(`  - ${c.join(' → ')}`);
        if (inc.deadExportsCount + inc.unresolvedCount + inc.cyclesCount === 0) lines.push('*No incremental findings related to changed files.*');
      }
      return lines.join('\n');
    },
    jsonl: (r) => {
      const rec = [];
      const push = (type, arr) => { if (Array.isArray(arr)) for (const item of arr) rec.push(item && typeof item === 'object' ? { _type: type, ...item } : { _type: type, value: item }); };
      push('changed-file', r.changedFiles);
      push('finding', r.findings);
      if (rec.length === 0) rec.push({ _type: 'summary', ok: r.ok, command: 'audit-diff', severity: r.summary?.severity });
      return rec.map(JSON.stringify).join('\n');
    },
  },
  'audit-file': {
    human: (r) => `file: ${r.file}\nresolvedPath: ${r.resolvedPath}\nseverity: ${r.summary.severity}\nimpactCount: ${r.impact.impactCount}\naffectedTestsCount: ${r.affectedTests.affectedTestsCount}`,
    summary: (r) => `File: ${r.file}\nSeverity: ${r.summary?.severity}\nImpact: ${r.impact?.impactCount ?? 0}\nAffected tests: ${r.affectedTests?.affectedTestsCount ?? 0}`,
    markdown: (r) => `# File Audit: ${r.file}\n\n- **Severity**: ${r.summary?.severity}\n- **Impact**: ${r.impact?.impactCount ?? 0}\n- **Affected tests**: ${r.affectedTests?.affectedTestsCount ?? 0}`,
  },
  'health': {
    human: (r) => `workspaceRoot: ${r.workspaceRoot}\nhealthScore: ${r.healthScore}\npackageManager: ${r.packageManager || 'unknown'}\nci: ${r.checks.ci.found ? 'yes' : 'no'}\ntests: ${r.checks.testConfig.found ? r.checks.testConfig.frameworks.join(', ') : 'none'}`,
    summary: (r) => `Health: ${r.healthScore}\nPassed: ${r.healthScoreNumeric?.passed}/${r.healthScoreNumeric?.total}\nMissing: ${r.fixes?.map((f) => f.check).join(', ') || 'none'}`,
    markdown: (r) => {
      const lines = [`# Health Check`, ``, `- **Score**: ${r.healthScore}`, `- **Passed**: ${r.healthScoreNumeric?.passed}/${r.healthScoreNumeric?.total}`];
      if (r.fixes?.length) { lines.push(``, `## Missing`); for (const f of r.fixes) lines.push(`- **${f.check}** (${f.severity}): ${f.action}`); }
      return lines.join('\n');
    },
    jsonl: (r) => {
      const rec = [];
      const push = (type, arr) => { if (Array.isArray(arr)) for (const item of arr) rec.push(item && typeof item === 'object' ? { _type: type, ...item } : { _type: type, value: item }); };
      push('check', r.checks);
      if (rec.length === 0) rec.push({ _type: 'summary', ok: r.ok, command: 'health', severity: r.severity || r.summary?.severity });
      return rec.map(JSON.stringify).join('\n');
    },
  },
  'impact': {
    human: (r) => [`impactCount: ${r.impactCount}`, ...r.impact.map((e) => { const via = e.via && e.via.length > 1 ? ` via ${e.via.slice(1).join(' -> ')}` : ''; return `${e.level}: ${e.file}${via}`; })].join('\n'),
    summary: (r) => [`Impact radius: ${r.impactCount ?? 0}`, ...r.impact?.slice(0, 5).map((e) => `  ${e.level}: ${e.file}`) || []].join('\n'),
    markdown: (r) => [`# Impact Radius`, ``, `- **Total**: ${r.impactCount ?? 0}`, ...r.impact?.slice(0, 10).map((e) => `- ${e.level}: ${e.file}`) || []].join('\n'),
    jsonl: (r) => {
      const rec = [];
      const push = (type, arr) => { if (Array.isArray(arr)) for (const item of arr) rec.push(item && typeof item === 'object' ? { _type: type, ...item } : { _type: type, value: item }); };
      push('impact', r.impact);
      if (rec.length === 0) rec.push({ _type: 'summary', ok: r.ok, command: 'impact', severity: r.severity || r.summary?.severity });
      return rec.map(JSON.stringify).join('\n');
    },
  },
  'affected-tests': {
    human: (r) => [`affectedTestsCount: ${r.affectedTestsCount}`, ...r.affectedTests.map((e) => { const via = e.via?.length > 0 ? ` via ${e.via.join(' -> ')}` : ''; return `${e.distance}: ${e.file}${via}`; })].join('\n'),
    summary: (r) => [`Affected tests: ${r.affectedTestsCount ?? 0}`, ...r.affectedTests?.slice(0, 5).map((e) => `  ${e.distance}: ${e.file}`) || []].join('\n'),
    markdown: (r) => [`# Affected Tests`, ``, `- **Total**: ${r.affectedTestsCount ?? 0}`, ...r.affectedTests?.slice(0, 10).map((e) => `- ${e.distance}: ${e.file}`) || []].join('\n'),
    jsonl: (r) => {
      const rec = [];
      const push = (type, arr) => { if (Array.isArray(arr)) for (const item of arr) rec.push(item && typeof item === 'object' ? { _type: type, ...item } : { _type: type, value: item }); };
      push('affected-test', r.affectedTests);
      if (rec.length === 0) rec.push({ _type: 'summary', ok: r.ok, command: 'affected-tests', severity: r.severity || r.summary?.severity });
      return rec.map(JSON.stringify).join('\n');
    },
  },
  'workspace-info': {
    human: (r) => `workspaceRoot: ${r.workspaceRoot}\ndetected: ${Object.entries(r.detected).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none'}`,
    summary: (r) => `Workspace: ${r.workspaceRoot}\nDetected: ${Object.entries(r.detected || {}).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none'}`,
    jsonl: (r) => JSON.stringify({ _type: 'workspace-info', ...r }),
  },
  'diagnostics': {
    human: (r) => {
      const diagTotal = r.diagnosticsSummary?.noLintersDetected ? 'no linters detected' : r.diagnosticsSummary?.total;
      return `checksRun: ${r.checksRun}\nfailedChecks: ${r.failedChecks.join(', ') || 'none'}\ndiagnostics: ${diagTotal}`;
    },
    summary: (r) => {
      const diagTotal = r.diagnosticsSummary?.noLintersDetected ? 'no linters detected' : r.diagnosticsSummary?.total;
      return `Checks: ${r.checksRun ?? 0}, Failed: ${r.failedChecks?.length ?? 0}\nDiagnostics: ${diagTotal ?? 'none'}`;
    },
    jsonl: (r) => {
      const rec = [];
      const push = (type, arr) => { if (Array.isArray(arr)) for (const item of arr) rec.push(item && typeof item === 'object' ? { _type: type, ...item } : { _type: type, value: item }); };
      push('diagnostic', r.results);
      if (rec.length === 0) rec.push({ _type: 'summary', ok: r.ok, command: 'diagnostics', severity: r.severity || r.summary?.severity });
      return rec.map(JSON.stringify).join('\n');
    },
  },
  'audit-map': {
    human: (r) => {
      if (r.summary) {
        return `severity: ${r.summary.severity}\nfiles: ${countTreeFiles(r.tree)}\nedges: ${r.edges?.length ?? 0}\nunresolved: ${r.issueOverlay?.unresolved?.length ?? 0}\ncycles: ${r.issueOverlay?.cycles?.length ?? 0}\ndeadExports: ${r.issueOverlay?.deadExports?.length ?? 0}\norphans: ${r.issueOverlay?.orphans?.length ?? 0}\nhotspots: ${r.issueOverlay?.hotspots?.length ?? 0}\nnext: ${r.summary.nextSteps[0]}`;
      }
      return `workspaceRoot: ${r.workspaceRoot}\nfiles: ${countTreeFiles(r.tree)}\nedges: ${r.edges?.length ?? 0}\ndeadExports: ${r.issueOverlay?.deadExports?.length ?? 0}\nunresolved: ${r.issueOverlay?.unresolved?.length ?? 0}\ncycles: ${r.issueOverlay?.cycles?.length ?? 0}\norphans: ${r.issueOverlay?.orphans?.length ?? 0}\nhotspots: ${r.issueOverlay?.hotspots?.length ?? 0}`;
    },
    summary: (r) => `Files: ${countTreeFiles(r.tree)}\nEdges: ${r.edges?.length ?? 0}\nIssues: dead=${r.issueOverlay?.deadExports?.length ?? 0} unresolved=${r.issueOverlay?.unresolved?.length ?? 0} cycles=${r.issueOverlay?.cycles?.length ?? 0}`,
    jsonl: (r) => {
      const rec = [];
      const push = (type, arr) => { if (Array.isArray(arr)) for (const item of arr) rec.push(item && typeof item === 'object' ? { _type: type, ...item } : { _type: type, value: item }); };
      push('highlighted-file', r.highlightedFiles);
      push('edge', r.edges);
      if (rec.length === 0) rec.push({ _type: 'summary', ok: r.ok, command: 'audit-map', severity: r.summary?.severity });
      return rec.map(JSON.stringify).join('\n');
    },
  },
  'stats': {
    human: (r) => Object.entries(r.stats || {}).map(([k, v]) => `${k}: ${v}`).join('\n'),
    summary: (r) => Object.entries(r.stats || {}).map(([k, v]) => `${k}: ${v}`).join(', '),
    jsonl: (r) => JSON.stringify({ _type: 'stats', ...r }),
  },
  'dependencies': {
    human: (r) => `file: ${r.file}\ndependenciesCount: ${r.dependenciesCount}\n${r.dependencies.map((d) => `  → ${d}`).join('\n')}`,
    summary: (r) => `Dependencies: ${r.dependenciesCount ?? 0}\n${(r.dependencies || []).slice(0, 5).join(', ') || 'none'}`,
    jsonl: (r) => {
      const rec = [];
      const push = (type, arr) => { if (Array.isArray(arr)) for (const item of arr) rec.push(item && typeof item === 'object' ? { _type: type, ...item } : { _type: type, value: item }); };
      push('dependency', r.dependencies);
      if (rec.length === 0) rec.push({ _type: 'summary', ok: r.ok, command: 'dependencies', severity: r.severity || r.summary?.severity });
      return rec.map(JSON.stringify).join('\n');
    },
  },
  'dependents': {
    human: (r) => `file: ${r.file}\ndependentsCount: ${r.dependentsCount}\n${r.dependents.map((d) => `  ← ${d}`).join('\n')}`,
    summary: (r) => `Dependents: ${r.dependentsCount ?? 0}\n${(r.dependents || []).slice(0, 5).join(', ') || 'none'}`,
    jsonl: (r) => {
      const rec = [];
      const push = (type, arr) => { if (Array.isArray(arr)) for (const item of arr) rec.push(item && typeof item === 'object' ? { _type: type, ...item } : { _type: type, value: item }); };
      push('dependent', r.dependents);
      if (rec.length === 0) rec.push({ _type: 'summary', ok: r.ok, command: 'dependents', severity: r.severity || r.summary?.severity });
      return rec.map(JSON.stringify).join('\n');
    },
  },
  'dead-exports': {
    human: (r) => {
      const lines = [`deadExportsCount: ${r.deadExportsCount}`];
      if (r.possibleFalsePositives?.disclaimer) lines.push(`note: ${r.possibleFalsePositives.disclaimer}`);
      lines.push(...r.deadExports.map((e) => `${e.file}: ${e.exports.map((e) => sanitizeForAiOutput(e)).join(', ')}`));
      return lines.join('\n');
    },
    summary: (r) => {
      const lines = [`Dead exports: ${r.deadExportsCount ?? 0}`];
      if (r.possibleFalsePositives?.disclaimer) lines.push(`Note: ${r.possibleFalsePositives.disclaimer}`);
      lines.push(...(r.deadExports || []).slice(0, 5).map((e) => `${e.file}: ${(e.exports || []).map((e) => sanitizeForAiOutput(e)).join(', ') || 'n/a'}`));
      return lines.join('\n');
    },
    jsonl: (r) => {
      const rec = [];
      const push = (type, arr) => { if (Array.isArray(arr)) for (const item of arr) rec.push(item && typeof item === 'object' ? { _type: type, ...item } : { _type: type, value: item }); };
      push('dead-export', r.deadExports);
      if (rec.length === 0) rec.push({ _type: 'summary', ok: r.ok, command: 'dead-exports', severity: r.severity || r.summary?.severity });
      return rec.map(JSON.stringify).join('\n');
    },
  },
  'unresolved': {
    human: (r) => {
      const lines = [`unresolvedCount: ${r.unresolvedCount}`];
      if (r.possibleFalsePositives?.disclaimer) lines.push(`note: ${r.possibleFalsePositives.disclaimer}`);
      lines.push(...r.unresolved.map((e) => `${e.file}: ${e.import}`));
      return lines.join('\n');
    },
    summary: (r) => {
      const lines = [`Unresolved: ${r.unresolvedCount ?? 0}`];
      if (r.possibleFalsePositives?.disclaimer) lines.push(`Note: ${r.possibleFalsePositives.disclaimer}`);
      lines.push(...(r.unresolved || []).slice(0, 5).map((u) => `${u.file}: ${u.import}`));
      return lines.join('\n');
    },
    jsonl: (r) => {
      const rec = [];
      const push = (type, arr) => { if (Array.isArray(arr)) for (const item of arr) rec.push(item && typeof item === 'object' ? { _type: type, ...item } : { _type: type, value: item }); };
      push('unresolved', r.unresolved);
      if (rec.length === 0) rec.push({ _type: 'summary', ok: r.ok, command: 'unresolved', severity: r.severity || r.summary?.severity });
      return rec.map(JSON.stringify).join('\n');
    },
  },
  'cycles': {
    human: (r) => [`cyclesCount: ${r.cyclesCount}`, ...r.cycles.map((c) => c.join(' -> '))].join('\n'),
    summary: (r) => `Cycles: ${r.cyclesCount ?? 0}\n${(r.cycles || []).slice(0, 3).map((c) => c.join(' -> ')).join('\n')}`,
    jsonl: (r) => {
      const rec = [];
      const push = (type, arr) => { if (Array.isArray(arr)) for (const item of arr) rec.push(item && typeof item === 'object' ? { _type: type, ...item } : { _type: type, value: item }); };
      push('cycle', r.cycles);
      if (rec.length === 0) rec.push({ _type: 'summary', ok: r.ok, command: 'cycles', severity: r.severity || r.summary?.severity });
      return rec.map(JSON.stringify).join('\n');
    },
  },
  'tree': {
    human: (r) => {
      const lines = [`file: ${r.file}`];
      function render(node, prefix = '') {
        if (node.imports) {
          for (const imp of node.imports) {
            const tag = imp.external ? ' [external]' : (imp.circular ? ' [circular]' : '');
            lines.push(`${prefix}→ ${imp.file}${tag}`);
            if (imp.imports || imp.dependents) render(imp, prefix + '  ');
          }
        }
        if (node.dependents) {
          for (const dep of node.dependents) {
            const tag = dep.circular ? ' [circular]' : '';
            lines.push(`${prefix}← ${dep.file}${tag}`);
            if (dep.imports || dep.dependents) render(dep, prefix + '  ');
          }
        }
      }
      if (r.tree) render(r.tree);
      return lines.join('\n');
    },
    summary: (r) => {
      const lines = [`File: ${r.file}`];
      if (r.tree?.imports) lines.push(`Imports: ${r.tree.imports.length}`);
      if (r.tree?.dependents) lines.push(`Dependents: ${r.tree.dependents.length}`);
      return lines.join('\n');
    },
    jsonl: (r) => JSON.stringify({ _type: 'tree', ...r }),
  },
};

// ---------------------------------------------------------------------------
// AI digest registry — per-command risk/action/count extraction
// ---------------------------------------------------------------------------
const AI_DIGEST = {
  'dead-exports': (r) => {
    const topRisks = [];
    const actions = [];
    const counts = {};
    if (r.deadExportsCount > 0) {
      counts.deadExports = r.deadExportsCount;
      topRisks.push({ category: 'dead-exports', severity: r.deadExportsCount > 10 ? 'high' : 'medium', count: r.deadExportsCount, message: `${r.deadExportsCount} dead export(s) found`, confidence: 0.85 });
      actions.push({ priority: 'P0', action: `Review ${r.deadExportsCount} dead-export candidate(s) before deletion` });
    }
    return { topRisks, actions, counts };
  },
  'impact': (r) => {
    const topRisks = [];
    const actions = [];
    const counts = {};
    if (r.impactCount > 0) {
      counts.impact = r.impactCount;
      topRisks.push({ category: 'impact', severity: r.impactCount > 20 ? 'high' : 'medium', count: r.impactCount, message: `Change would affect ${r.impactCount} file(s)`, confidence: 0.9 });
      actions.push({ priority: 'P0', action: 'Run affected-tests to identify tests to update' });
    }
    return { topRisks, actions, counts };
  },
  'affected-tests': (r) => {
    const topRisks = [];
    const actions = [];
    const counts = {};
    if (r.affectedTestsCount > 0) {
      counts.affectedTests = r.affectedTestsCount;
      topRisks.push({ category: 'tests', severity: 'medium', count: r.affectedTestsCount, message: `${r.affectedTestsCount} test file(s) affected`, confidence: 0.9 });
      actions.push({ priority: 'P0', action: `Run ${r.affectedTestsCount} affected test(s)` });
    }
    return { topRisks, actions, counts };
  },
  'cycles': (r) => {
    const topRisks = [];
    const actions = [];
    const counts = {};
    if (r.cyclesCount > 0) {
      counts.cycles = r.cyclesCount;
      topRisks.push({ category: 'cycles', severity: 'high', count: r.cyclesCount, message: `${r.cyclesCount} dependency cycle(s) detected`, confidence: 0.95 });
      actions.push({ priority: 'P0', action: 'Break dependency cycles before they grow' });
    }
    return { topRisks, actions, counts };
  },
  'unresolved': (r) => {
    const topRisks = [];
    const actions = [];
    const counts = {};
    if (r.unresolvedCount > 0) {
      counts.unresolved = r.unresolvedCount;
      topRisks.push({ category: 'unresolved', severity: 'medium', count: r.unresolvedCount, message: `${r.unresolvedCount} unresolved import(s)`, confidence: 0.85 });
      actions.push({ priority: 'P0', action: 'Fix unresolved imports to prevent runtime errors' });
    }
    return { topRisks, actions, counts };
  },
  'audit-security': (r) => {
    const topRisks = [];
    const actions = [];
    const counts = {};
    if (r.summary?.total > 0) {
      counts.securityFindings = r.summary.total;
      const sev = r.summary.bySeverity || {};
      const severity = sev.high > 0 ? 'high' : sev.medium > 0 ? 'medium' : 'low';
      topRisks.push({ category: 'security', severity, count: r.summary.total, message: `${r.summary.total} security finding(s)`, confidence: 0.8 });
      actions.push({ priority: 'P0', action: 'Review security findings manually before relying on auto-fixes' });
    }
    return { topRisks, actions, counts };
  },
  'audit-diff': (r) => {
    const topRisks = [];
    const actions = [];
    const counts = {};
    if (r.summary?.counts?.highCompositeRiskFiles > 0) {
      counts.highCompositeRiskFiles = r.summary.counts.highCompositeRiskFiles;
      topRisks.push({ category: 'diff-risk', severity: 'high', count: r.summary.counts.highCompositeRiskFiles, message: `${r.summary.counts.highCompositeRiskFiles} high-risk changed file(s)`, confidence: 0.85 });
    }
    if (r.summary?.counts?.affectedTests > 0) {
      counts.affectedTests = r.summary.counts.affectedTests;
      actions.push({ priority: 'P0', action: `Run ${r.summary.counts.affectedTests} affected test(s)` });
    }
    return { topRisks, actions, counts };
  },
  'audit-file': (r) => {
    const topRisks = [];
    const actions = [];
    const counts = {};
    if (r.impact?.impactCount > 0 || r.affectedTests?.affectedTestsCount > 0) {
      counts.impact = r.impact?.impactCount || 0;
      counts.affectedTests = r.affectedTests?.affectedTestsCount || 0;
      if (counts.impact > 20) {
        topRisks.push({ category: 'impact', severity: 'high', count: counts.impact, message: `Editing this file would transitively impact ${counts.impact} file(s)`, confidence: 0.9 });
      } else if (counts.impact > 0) {
        topRisks.push({ category: 'impact', severity: 'medium', count: counts.impact, message: `Editing this file would transitively impact ${counts.impact} file(s)`, confidence: 0.9 });
      }
      if (counts.affectedTests > 0) {
        topRisks.push({ category: 'tests', severity: 'medium', count: counts.affectedTests, message: `${counts.affectedTests} test(s) affected`, confidence: 0.9 });
        actions.push({ priority: 'P0', action: `Run ${counts.affectedTests} affected test(s)` });
      }
      if (counts.impact > 0) {
        actions.push({ priority: 'P1', action: 'Run affected-tests to find specific files' });
      }
    }
    return { topRisks, actions, counts };
  },
};

// ---------------------------------------------------------------------------
// Dispatch functions — pure registry lookup, zero switch-case
// ---------------------------------------------------------------------------
function formatHuman(command, result) {
  if (!result || result.ok === false) {
    return `Error: ${result?.error || 'Command failed'}`;
  }
  const fn = FORMATTERS[command]?.human;
  if (fn) return fn(result);
  return JSON.stringify(result, null, 2);
}

function formatSummary(command, result) {
  if (!result || result.ok === false) {
    return `Error: ${result?.error || 'Command failed'}`;
  }
  const fn = FORMATTERS[command]?.summary;
  if (fn) return fn(result);
  return formatHuman(command, result);
}

function formatMarkdown(command, result) {
  if (!result || result.ok === false) {
    return `## Error\n\n${result?.error || 'Command failed'}`;
  }
  const fn = FORMATTERS[command]?.markdown;
  if (fn) return fn(result);
  return formatHuman(command, result);
}

function formatJsonl(command, result) {
  if (!result || result.ok === false) {
    return JSON.stringify({ _type: 'error', error: result?.error || 'Command failed' });
  }
  const fn = FORMATTERS[command]?.jsonl;
  if (fn) return fn(result);
  return JSON.stringify({ _type: command, ...result });
}

function buildCommandAiDigest(command, result) {
  const fn = AI_DIGEST[command];
  if (fn) return fn(result);
  return { topRisks: [], actions: [], counts: {} };
}

function formatAi(command, result, options = {}) {
  if (!result || result.ok === false) {
    return JSON.stringify({ ok: false, error: result?.error || 'Command failed' });
  }

  const depth = options.depth || 'detail';
  const tokenBudget = options.tokenBudget || null;
  const schemaVersion = options.schemaVersion || '1.2.0';

  if (command === 'audit-summary') {
    function buildOutput(currentDepth) {
      const output = {
        ok: true,
        schemaVersion,
        severity: result.summary?.severity || 'low',
        meta: {
          workspaceRoot: result.workspaceRoot,
          totalFiles: result.scope?.counts?.totalFiles ?? 0,
          mainlineFiles: result.scope?.counts?.mainlineFiles ?? 0,
          coverageRatio: result.summary?.analysisCoverage?.coverageRatio ?? null,
        },
        counts: {
          deadExports: result.deadExports?.deadExportsCount ?? 0,
          unresolved: result.unresolved?.unresolvedCount ?? 0,
          cycles: result.cycles?.cyclesCount ?? 0,
          missingHygieneChecks: result.summary?.counts?.missingHygieneChecks ?? 0,
        },
        topRisks: [],
        actions: [],
        confidence: {
          overall: 1.0,
          coverageRatio: result.summary?.analysisCoverage?.coverageRatio ?? 1.0,
        },
      };

      const cov = result.summary?.analysisCoverage;
      if (cov && cov.coverageRatio < 0.5) {
        output.topRisks.push({ category: 'coverage', severity: 'high', message: `Analysis coverage is low (${Math.round(cov.coverageRatio * 100)}%); findings may be incomplete`, confidence: 1.0 });
      }
      if (output.counts.cycles > 0) {
        output.topRisks.push({ category: 'cycles', severity: 'high', count: output.counts.cycles, message: `${output.counts.cycles} dependency cycle(s) detected`, confidence: 0.95 });
      }
      if (output.counts.unresolved > 0) {
        const fp = result.unresolved?.possibleFalsePositives;
        const fpRatio = fp?.total > 0 ? fp.count / fp.total : 0;
        output.topRisks.push({ category: 'unresolved', severity: 'medium', count: output.counts.unresolved, message: `${output.counts.unresolved} unresolved import(s)${fpRatio > 0.5 ? ` (~${Math.round(fpRatio * 100)}% likely false positives)` : ''}`, confidence: fpRatio > 0.5 ? 0.5 : 0.85 });
      }
      if (output.counts.deadExports > 0) {
        const fp = result.deadExports?.possibleFalsePositives;
        const fpRatio = fp?.total > 0 ? fp.count / fp.total : 0;
        output.topRisks.push({ category: 'dead-exports', severity: output.counts.deadExports > 10 ? 'high' : 'medium', count: output.counts.deadExports, message: `${output.counts.deadExports} dead export(s)${fpRatio > 0.5 ? ` (~${Math.round(fpRatio * 100)}% likely false positives)` : ''}`, confidence: fpRatio > 0.5 ? 0.5 : 0.85 });
      }
      if (result.health?.healthScoreNumeric?.ratio < 1) {
        const missing = result.health?.fixes?.map((f) => f.check).join(', ') || '';
        output.topRisks.push({ category: 'health', severity: 'low', message: `Health gaps: ${missing}`, confidence: 0.9 });
      }

      const actions = [];
      if (result.deadExports?.deadExportsCount > 0) actions.push({ priority: 'P0', action: 'run: workspace-bridge-cli dead-exports --json --quiet' });
      if (result.cycles?.cyclesCount > 0) actions.push({ priority: 'P0', action: 'run: workspace-bridge-cli cycles --json --quiet' });
      if (result.unresolved?.unresolvedCount > 0) actions.push({ priority: 'P0', action: 'run: workspace-bridge-cli unresolved --json --quiet' });
      if (result.health?.healthScoreNumeric?.ratio < 1) actions.push({ priority: 'P1', action: 'run: workspace-bridge-cli diagnostics --mode full --json --quiet' });
      const coverage = result.summary?.analysisCoverage;
      if (coverage && coverage.coverageRatio < 0.5) actions.push({ priority: 'P2', action: 'run: workspace-bridge-cli audit-map --compact --json --quiet' });
      if (actions.length === 0) {
        const steps = result.summary?.nextSteps || result.summary?.recommendations || [];
        for (const step of steps.slice(0, 3)) actions.push({ priority: actions.length === 0 ? 'P0' : `P${actions.length}`, action: step });
      }
      output.actions = actions.slice(0, 3);

      if (result.warnings && result.warnings.length > 0) output.warnings = result.warnings;

      if (currentDepth === 'detail' || currentDepth === 'full') {
        output.riskFiles = {};
        if (result.deadExports?.deadExports?.length > 0) output.riskFiles.deadExports = result.deadExports.deadExports.slice(0, 3).map((d) => ({ file: d.file, exports: (d.exports || []).slice(0, 3).map((e) => sanitizeForAiOutput(e)), confidence: d.confidence }));
        if (result.unresolved?.unresolved?.length > 0) output.riskFiles.unresolved = result.unresolved.unresolved.slice(0, 3).map((u) => ({ file: u.file, import: u.import }));
        if (result.cycles?.cycles?.length > 0) output.riskFiles.cycles = result.cycles.cycles.slice(0, 3).map((c) => ({ files: c.files, length: c.length }));
        if (Object.keys(output.riskFiles).length === 0) delete output.riskFiles;
      }
      if (currentDepth === 'full') {
        output.details = { deadExports: result.deadExports?.deadExports || [], unresolved: result.unresolved?.unresolved || [], cycles: result.cycles?.cycles || [] };
      }
      if (currentDepth === 'surface') {
        return { ok: true, severity: result.summary?.severity || 'low', counts: output.counts, topRisks: output.topRisks.slice(0, 3).map((rr) => ({ category: rr.category, severity: rr.severity, ...(rr.count !== undefined ? { count: rr.count } : {}) })) };
      }
      return output;
    }
    let output = buildOutput(depth);
    if (tokenBudget) {
      let estimatedTokens = JSON.stringify(output).length / AI_FORMAT.ESTIMATED_CHARS_PER_TOKEN;
      if (estimatedTokens > tokenBudget && depth !== 'surface') {
        output = buildOutput('surface');
        estimatedTokens = JSON.stringify(output).length / AI_FORMAT.ESTIMATED_CHARS_PER_TOKEN;
      }
      if (estimatedTokens > tokenBudget) {
        output = { ok: output.ok, severity: output.severity, counts: output.counts };
      }
    }
    return JSON.stringify(output, null, 2);
  }

  const { topRisks, actions, counts } = buildCommandAiDigest(command, result);

  if (depth === 'surface') {
    const surface = { ok: true, schemaVersion, command, severity: result.summary?.severity || 'low', counts };
    if (topRisks.length > 0) surface.topRisks = topRisks.slice(0, 3).map((rr) => ({ category: rr.category, severity: rr.severity, ...(rr.count !== undefined ? { count: rr.count } : {}) }));
    if (actions.length > 0) surface.actions = actions.slice(0, 3);
    return JSON.stringify(surface);
  }

  const output = {
    ok: true,
    schemaVersion,
    command,
    severity: result.summary?.severity || 'low',
    counts,
    summary: formatSummary(command, result),
    confidence: { overall: 1.0 },
  };
  if (topRisks.length > 0) output.topRisks = topRisks;
  if (actions.length > 0) output.actions = actions;

  if (command === 'audit-file') {
    if (depth === 'detail' || depth === 'full') {
      output.riskFiles = {};
      if (result.impact?.impact?.length > 0) output.riskFiles.impact = result.impact.impact.slice(0, 3).map((i) => ({ file: i.file, level: i.level }));
      if (result.affectedTests?.affectedTests?.length > 0) output.riskFiles.affectedTests = result.affectedTests.affectedTests.slice(0, 3).map((t) => ({ file: t.file, distance: t.distance }));
      if (Object.keys(output.riskFiles).length === 0) delete output.riskFiles;
    }
    if (depth === 'full') {
      output.details = { impact: result.impact?.impact || [], affectedTests: result.affectedTests?.affectedTests || [] };
    }
  } else {
    if (depth === 'full' && result.details) output.details = result.details;
  }

  if (tokenBudget) {
    let estimatedTokens = JSON.stringify(output).length / AI_FORMAT.ESTIMATED_CHARS_PER_TOKEN;
    if (estimatedTokens > tokenBudget) {
      const slim = { ok: output.ok, schemaVersion, command, severity: output.severity, counts, topRisks: output.topRisks?.slice(0, 3), actions: output.actions?.slice(0, 3) };
      estimatedTokens = JSON.stringify(slim).length / AI_FORMAT.ESTIMATED_CHARS_PER_TOKEN;
      if (estimatedTokens <= tokenBudget) return JSON.stringify(slim, null, 2);
      const minimal = { ok: output.ok, schemaVersion, command, severity: output.severity, counts };
      return JSON.stringify(minimal, null, 2);
    }
  }
  return JSON.stringify(output, null, 2);
}

module.exports = { formatHuman, formatSummary, formatMarkdown, formatJsonl, formatAi, formatAuditSummary };
