/**
 * Human-readable formatters for CLI commands.
 * Extracted from cli.js to reduce the facade thickness.
 */
const { countTreeFiles } = require('./project-map');
const { AI_FORMAT } = require('../../config/constants');

/**
 * Shared audit-summary formatter across text output styles.
 * Eliminates the duplicate `case 'audit-summary'` in 3+ switch blocks.
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
        ? `- **[${f.severity.toUpperCase()}]** \`${f.ruleId}\` — ${f.file}${f.lineStart ? ':' + f.lineStart : ''}`
        : `${bp}[${f.severity.toUpperCase()}] ${f.ruleId} — ${f.file}${f.lineStart ? ':' + f.lineStart : ''}`
      );
      if (f.message && !isSum) lines.push(isMd ? `  - ${f.message}` : `  ${f.message}`);
      if (f.matchedText) {
        const m = `Matched: \`${f.matchedText}\``;
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

function formatMarkdown(command, result) {
  if (!result || result.ok === false) {
    return `## Error\n\n${result?.error || 'Command failed'}`;
  }
  switch (command) {
    case 'audit-summary':
      return formatAuditSummary(result, 'markdown');
    case 'audit-overview': {
      const agg = result.aggregates || {};
      const langSupport = result.languageSupport || {};
      const langSummary = Object.entries(langSupport)
        .map(([lang, info]) => `${lang}(${info.level}/${info.confidence})`)
        .join(', ');
      const lines = [
        `# Project Overview`,
        ``,
        `- **Severity**: ${result.summary?.severity || 'low'}`,
        `- **Files**: ${result.skeleton?.totalFiles ?? 0} total, ${result.skeleton?.mainlineFiles ?? 0} mainline`,
        `- **Hotspots**: ${agg.hotspotsByRisk?.high ?? 0} high, ${agg.hotspotsByRisk?.medium ?? 0} medium`,
        `- **Fragile modules**: ${agg.stabilityCounts?.fragile ?? 0}`,
        `- **Orphans**: ${result.orphans?.counts?.total ?? 0}`,
        `- **Languages**: ${langSummary || 'none detected'}`,
      ];
      if (result.summary?.recommendations?.length) {
        lines.push('', `## Recommendations`);
        for (const rec of result.summary.recommendations.slice(0, 3)) {
          lines.push(`- ${rec}`);
        }
      }
      return lines.join('\n');
    }
    case 'audit-security': {
      const lines = ['# Security Audit', '', ...buildSecurityLines(result, 'markdown')];
      return lines.join('\n');
    }
    case 'audit-diff': {
      const lines = [
        `# Diff Audit`,
        ``,
        `- **Severity**: ${result.summary?.severity}`,
        `- **Changed files**: ${result.summary?.counts?.changedFiles ?? 0}`,
        `- **Mainline changed**: ${result.summary?.counts?.mainlineChangedFiles ?? 0}`,
        `- **Affected tests**: ${result.summary?.counts?.affectedTests ?? 0}`,
      ];
      if (result.validationAdvice?.phases?.length) {
        lines.push(`- **Validation phases**: ${result.validationAdvice.phases.length}`);
      }
      if (result.incremental && result.incrementalFindings) {
        const inc = result.incrementalFindings;
        lines.push('', `## Incremental Findings`, `- **Dead exports**: ${inc.deadExportsCount}`, `- **Unresolved**: ${inc.unresolvedCount}`, `- **Cycles**: ${inc.cyclesCount}`);
        for (const de of inc.deadExports.slice(0, 3)) lines.push(`  - \`${de.file}\`: ${de.exports?.join(', ') || 'n/a'}`);
        for (const u of inc.unresolved.slice(0, 3)) lines.push(`  - \`${u.file}\`: ${u.import}`);
        for (const c of inc.cycles.slice(0, 3)) lines.push(`  - ${c.join(' → ')}`);
        if (inc.deadExportsCount + inc.unresolvedCount + inc.cyclesCount === 0) lines.push('*No incremental findings related to changed files.*');
      }
      return lines.join('\n');
    }
    case 'audit-file': {
      return [
        `# File Audit: ${result.file}`,
        ``,
        `- **Severity**: ${result.summary?.severity}`,
        `- **Impact**: ${result.impact?.impactCount ?? 0}`,
        `- **Affected tests**: ${result.affectedTests?.affectedTestsCount ?? 0}`,
      ].join('\n');
    }
    case 'health': {
      const lines = [
        `# Health Check`,
        ``,
        `- **Score**: ${result.healthScore}`,
        `- **Passed**: ${result.healthScoreNumeric?.passed}/${result.healthScoreNumeric?.total}`,
      ];
      if (result.fixes?.length) {
        lines.push('', `## Missing`);
        for (const f of result.fixes) {
          lines.push(`- **${f.check}** (${f.severity}): ${f.action}`);
        }
      }
      return lines.join('\n');
    }
    case 'impact': {
      const lines = [`# Impact Radius`, ``, `- **Total**: ${result.impactCount ?? 0}`];
      for (const e of result.impact?.slice(0, 10) || []) {
        lines.push(`- ${e.level}: ${e.file}`);
      }
      return lines.join('\n');
    }
    case 'affected-tests': {
      const lines = [`# Affected Tests`, ``, `- **Total**: ${result.affectedTestsCount ?? 0}`];
      for (const e of result.affectedTests?.slice(0, 10) || []) {
        lines.push(`- ${e.distance}: ${e.file}`);
      }
      return lines.join('\n');
    }
    default:
      return formatHuman(command, result);
  }
}

function formatSummary(command, result) {
  if (!result || result.ok === false) {
    return `Error: ${result?.error || 'Command failed'}`;
  }
  switch (command) {
    case 'audit-summary':
      return formatAuditSummary(result, 'summary');
    case 'audit-overview': {
      const agg = result.aggregates || {};
      const langSupport = result.languageSupport || {};
      const langSummary = Object.entries(langSupport)
        .map(([lang, info]) => `${lang}(${info.level}/${info.confidence})`)
        .join(', ');
      const lines = [
        `Severity: ${result.summary?.severity || 'low'}`,
        `Files: ${result.skeleton?.totalFiles ?? 0} total, ${result.skeleton?.mainlineFiles ?? 0} mainline`,
        `Hotspots: ${agg.hotspotsByRisk?.high ?? 0} high, ${agg.hotspotsByRisk?.medium ?? 0} medium`,
        `Fragile modules: ${agg.stabilityCounts?.fragile ?? 0}`,
        `Orphans: ${result.orphans?.counts?.total ?? 0}`,
        `Languages: ${langSummary || 'none detected'}`,
      ];
      if (result.summary?.recommendations?.length) {
        lines.push('Recommendations:');
        for (const rec of result.summary.recommendations.slice(0, 2)) {
          lines.push(`  • ${rec}`);
        }
      }
      return lines.join('\n');
    }
    case 'audit-security': {
      return buildSecurityLines(result, 'summary').join('\n');
    }
    case 'audit-diff': {
      const lines = [
        `Severity: ${result.summary?.severity}`,
        `Changed files: ${result.summary?.counts?.changedFiles ?? 0}`,
        `Mainline changed: ${result.summary?.counts?.mainlineChangedFiles ?? 0}`,
        `Affected tests: ${result.summary?.counts?.affectedTests ?? 0}`,
        `High composite risk: ${result.summary?.counts?.highCompositeRiskFiles ?? 0}`,
      ];
      if (result.validationAdvice?.phases?.length) {
        lines.push(`Validation phases: ${result.validationAdvice.phases.length}`);
      }
      if (result.incremental && result.incrementalFindings) {
        const inc = result.incrementalFindings;
        lines.push(`Incremental: dead=${inc.deadExportsCount} unresolved=${inc.unresolvedCount} cycles=${inc.cyclesCount}`);
        for (const de of inc.deadExports.slice(0, 3)) lines.push(`  dead-export: ${de.file}`);
        for (const u of inc.unresolved.slice(0, 3)) lines.push(`  unresolved: ${u.file}`);
        for (const c of inc.cycles.slice(0, 3)) lines.push(`  cycle: ${c.join(' -> ')}`);
      }
      return lines.join('\n');
    }
    case 'audit-file': {
      return [
        `File: ${result.file}`,
        `Severity: ${result.summary?.severity}`,
        `Impact: ${result.impact?.impactCount ?? 0}`,
        `Affected tests: ${result.affectedTests?.affectedTestsCount ?? 0}`,
      ].join('\n');
    }
    case 'health':
      return [
        `Health: ${result.healthScore}`,
        `Passed: ${result.healthScoreNumeric?.passed}/${result.healthScoreNumeric?.total}`,
        `Missing: ${result.fixes?.map((f) => f.check).join(', ') || 'none'}`,
      ].join('\n');
    case 'impact':
      return [`Impact radius: ${result.impactCount ?? 0}`, ...result.impact?.slice(0, 5).map((e) => `  ${e.level}: ${e.file}`) || []].join('\n');
    case 'affected-tests':
      return [`Affected tests: ${result.affectedTestsCount ?? 0}`, ...result.affectedTests?.slice(0, 5).map((e) => `  ${e.distance}: ${e.file}`) || []].join('\n');
    case 'workspace-info': {
      const detected = Object.entries(result.detected || {})
        .filter(([, v]) => v)
        .map(([k]) => k)
        .join(', ') || 'none';
      return `Workspace: ${result.workspaceRoot}\nDetected: ${detected}`;
    }
    case 'diagnostics': {
      const diagTotal = result.diagnosticsSummary?.noLintersDetected
        ? 'no linters detected'
        : result.diagnosticsSummary?.total;
      return `Checks: ${result.checksRun ?? 0}, Failed: ${result.failedChecks?.length ?? 0}\nDiagnostics: ${diagTotal ?? 'none'}`;
    }
    case 'audit-map': {
      const lines = [
        `Files: ${countTreeFiles(result.tree)}`,
        `Edges: ${result.edges?.length ?? 0}`,
        `Issues: dead=${result.issueOverlay?.deadExports?.length ?? 0} unresolved=${result.issueOverlay?.unresolved?.length ?? 0} cycles=${result.issueOverlay?.cycles?.length ?? 0}`,
      ];
      return lines.join('\n');
    }
    case 'stats':
      return Object.entries(result.stats || {})
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');
    case 'dependencies': {
      const deps = (result.dependencies || []).slice(0, 5).join(', ') || 'none';
      return `Dependencies: ${result.dependenciesCount ?? 0}\n${deps}`;
    }
    case 'dependents': {
      const deps = (result.dependents || []).slice(0, 5).join(', ') || 'none';
      return `Dependents: ${result.dependentsCount ?? 0}\n${deps}`;
    }
    case 'dead-exports': {
      const lines = [`Dead exports: ${result.deadExportsCount ?? 0}`];
      if (result.possibleFalsePositives?.disclaimer) {
        lines.push(`Note: ${result.possibleFalsePositives.disclaimer}`);
      }
      lines.push(...((result.deadExports || []).slice(0, 5).map((e) => `${e.file}: ${e.exports?.join(', ')}`)));
      return lines.join('\n');
    }
    case 'unresolved': {
      const lines = [`Unresolved: ${result.unresolvedCount ?? 0}`];
      if (result.possibleFalsePositives?.disclaimer) {
        lines.push(`Note: ${result.possibleFalsePositives.disclaimer}`);
      }
      lines.push(...((result.unresolved || []).slice(0, 5).map((u) => `${u.file}: ${u.import}`)));
      return lines.join('\n');
    }
    case 'cycles': {
      const cycles = (result.cycles || []).slice(0, 3).map((c) => c.join(' -> ')).join('\n');
      return `Cycles: ${result.cyclesCount ?? 0}\n${cycles}`;
    }
    case 'tree': {
      const lines = [`File: ${result.file}`];
      if (result.tree?.imports) {
        lines.push(`Imports: ${result.tree.imports.length}`);
      }
      if (result.tree?.dependents) {
        lines.push(`Dependents: ${result.tree.dependents.length}`);
      }
      return lines.join('\n');
    }
    default:
      return formatHuman(command, result);
  }
}

/**
 * AI-pre-digested output — curated JSON that LLMs can consume directly.
 * Produces severity + top risks + actions + confidence, not raw dumps.
 */
function buildCommandAiDigest(command, result) {
  const topRisks = [];
  const actions = [];
  const counts = {};
  switch (command) {
    case 'dead-exports':
      if (result.deadExportsCount > 0) {
        counts.deadExports = result.deadExportsCount;
        topRisks.push({ category: 'dead-exports', severity: result.deadExportsCount > 10 ? 'high' : 'medium', count: result.deadExportsCount, message: `${result.deadExportsCount} dead export(s) found`, confidence: 0.85 });
        actions.push({ priority: 'P0', action: `Review ${result.deadExportsCount} dead-export candidate(s) before deletion` });
      }
      break;
    case 'impact':
      if (result.impactCount > 0) {
        counts.impact = result.impactCount;
        topRisks.push({ category: 'impact', severity: result.impactCount > 20 ? 'high' : 'medium', count: result.impactCount, message: `Change would affect ${result.impactCount} file(s)`, confidence: 0.9 });
        actions.push({ priority: 'P0', action: 'Run affected-tests to identify tests to update' });
      }
      break;
    case 'affected-tests':
      if (result.affectedTestsCount > 0) {
        counts.affectedTests = result.affectedTestsCount;
        topRisks.push({ category: 'tests', severity: 'medium', count: result.affectedTestsCount, message: `${result.affectedTestsCount} test file(s) affected`, confidence: 0.9 });
        actions.push({ priority: 'P0', action: `Run ${result.affectedTestsCount} affected test(s)` });
      }
      break;
    case 'cycles':
      if (result.cyclesCount > 0) {
        counts.cycles = result.cyclesCount;
        topRisks.push({ category: 'cycles', severity: 'high', count: result.cyclesCount, message: `${result.cyclesCount} dependency cycle(s) detected`, confidence: 0.95 });
        actions.push({ priority: 'P0', action: 'Break dependency cycles before they grow' });
      }
      break;
    case 'unresolved':
      if (result.unresolvedCount > 0) {
        counts.unresolved = result.unresolvedCount;
        topRisks.push({ category: 'unresolved', severity: 'medium', count: result.unresolvedCount, message: `${result.unresolvedCount} unresolved import(s)`, confidence: 0.85 });
        actions.push({ priority: 'P0', action: 'Fix unresolved imports to prevent runtime errors' });
      }
      break;
    case 'audit-security':
      if (result.summary?.total > 0) {
        counts.securityFindings = result.summary.total;
        const sev = result.summary.bySeverity || {};
        const severity = sev.high > 0 ? 'high' : sev.medium > 0 ? 'medium' : 'low';
        topRisks.push({ category: 'security', severity, count: result.summary.total, message: `${result.summary.total} security finding(s)`, confidence: 0.8 });
        actions.push({ priority: 'P0', action: 'Review security findings manually before relying on auto-fixes' });
      }
      break;
    case 'audit-diff':
      if (result.summary?.counts?.highCompositeRiskFiles > 0) {
        counts.highCompositeRiskFiles = result.summary.counts.highCompositeRiskFiles;
        topRisks.push({ category: 'diff-risk', severity: 'high', count: result.summary.counts.highCompositeRiskFiles, message: `${result.summary.counts.highCompositeRiskFiles} high-risk changed file(s)`, confidence: 0.85 });
      }
      if (result.summary?.counts?.affectedTests > 0) {
        counts.affectedTests = result.summary.counts.affectedTests;
        actions.push({ priority: 'P0', action: `Run ${result.summary.counts.affectedTests} affected test(s)` });
      }
      break;
  }
  return { topRisks, actions, counts };
}

function formatAi(command, result, options = {}) {
  if (!result || result.ok === false) {
    return JSON.stringify({ ok: false, error: result?.error || 'Command failed' });
  }

  const depth = options.depth || 'detail';
  const tokenBudget = options.tokenBudget || null;
  const schemaVersion = options.schemaVersion || '1.2.0';

  if (command !== 'audit-summary') {
    const { topRisks, actions, counts } = buildCommandAiDigest(command, result);

    if (depth === 'surface') {
      const surface = { ok: true, schemaVersion, command, severity: result.summary?.severity || 'low', counts };
      if (topRisks.length > 0) surface.topRisks = topRisks.slice(0, 3).map((r) => ({ category: r.category, severity: r.severity, ...(r.count !== undefined ? { count: r.count } : {}) }));
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
    if (depth === 'full' && result.details) output.details = result.details;

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

    // Build top risks in priority order
    const cov = result.summary?.analysisCoverage;
    if (cov && cov.coverageRatio < 0.5) {
      output.topRisks.push({
        category: 'coverage',
        severity: 'high',
        message: `Analysis coverage is low (${Math.round(cov.coverageRatio * 100)}%); findings may be incomplete`,
        confidence: 1.0,
      });
    }
    if (output.counts.cycles > 0) {
      output.topRisks.push({
        category: 'cycles',
        severity: 'high',
        count: output.counts.cycles,
        message: `${output.counts.cycles} dependency cycle(s) detected`,
        confidence: 0.95,
      });
    }
    if (output.counts.unresolved > 0) {
      const fp = result.unresolved?.possibleFalsePositives;
      const fpRatio = fp?.total > 0 ? fp.count / fp.total : 0;
      output.topRisks.push({
        category: 'unresolved',
        severity: 'medium',
        count: output.counts.unresolved,
        message: `${output.counts.unresolved} unresolved import(s)${fpRatio > 0.5 ? ` (~${Math.round(fpRatio * 100)}% likely false positives)` : ''}`,
        confidence: fpRatio > 0.5 ? 0.5 : 0.85,
      });
    }
    if (output.counts.deadExports > 0) {
      const fp = result.deadExports?.possibleFalsePositives;
      const fpRatio = fp?.total > 0 ? fp.count / fp.total : 0;
      output.topRisks.push({
        category: 'dead-exports',
        severity: output.counts.deadExports > 10 ? 'high' : 'medium',
        count: output.counts.deadExports,
        message: `${output.counts.deadExports} dead export(s)${fpRatio > 0.5 ? ` (~${Math.round(fpRatio * 100)}% likely false positives)` : ''}`,
        confidence: fpRatio > 0.5 ? 0.5 : 0.85,
      });
    }
    if (result.health?.healthScoreNumeric?.ratio < 1) {
      const missing = result.health?.fixes?.map((f) => f.check).join(', ') || '';
      output.topRisks.push({
        category: 'health',
        severity: 'low',
        message: `Health gaps: ${missing}`,
        confidence: 0.9,
      });
    }

    // Build executable actions instead of free-text recommendations
    const actions = [];
    if (result.deadExports?.deadExportsCount > 0) {
      actions.push({ priority: 'P0', action: 'run: workspace-bridge-cli dead-exports --json --quiet' });
    }
    if (result.cycles?.cyclesCount > 0) {
      actions.push({ priority: 'P0', action: 'run: workspace-bridge-cli cycles --json --quiet' });
    }
    if (result.unresolved?.unresolvedCount > 0) {
      actions.push({ priority: 'P0', action: 'run: workspace-bridge-cli unresolved --json --quiet' });
    }
    if (result.health?.healthScoreNumeric?.ratio < 1) {
      actions.push({ priority: 'P1', action: 'run: workspace-bridge-cli diagnostics --mode full --json --quiet' });
    }
    const coverage = result.summary?.analysisCoverage;
    if (coverage && coverage.coverageRatio < 0.5) {
      actions.push({ priority: 'P2', action: 'run: workspace-bridge-cli audit-map --compact --json --quiet' });
    }
    if (actions.length === 0) {
      const steps = result.summary?.nextSteps || result.summary?.recommendations || [];
      for (const step of steps.slice(0, 3)) {
        actions.push({ priority: actions.length === 0 ? 'P0' : `P${actions.length}`, action: step });
      }
    }
    output.actions = actions.slice(0, 3);

    if (result.warnings && result.warnings.length > 0) {
      output.warnings = result.warnings;
    }

    // Depth-specific additions
    if (currentDepth === 'detail' || currentDepth === 'full') {
      output.riskFiles = {};
      if (result.deadExports?.deadExports?.length > 0) {
        output.riskFiles.deadExports = result.deadExports.deadExports.slice(0, 3).map((d) => ({
          file: d.file,
          exports: d.exports?.slice(0, 3),
          confidence: d.confidence,
        }));
      }
      if (result.unresolved?.unresolved?.length > 0) {
        output.riskFiles.unresolved = result.unresolved.unresolved.slice(0, 3).map((u) => ({
          file: u.file,
          import: u.import,
        }));
      }
      if (result.cycles?.cycles?.length > 0) {
        output.riskFiles.cycles = result.cycles.cycles.slice(0, 3).map((c) => ({
          files: c.files,
          length: c.length,
        }));
      }
      if (Object.keys(output.riskFiles).length === 0) {
        delete output.riskFiles;
      }
    }

    if (currentDepth === 'full') {
      output.details = {
        deadExports: result.deadExports?.deadExports || [],
        unresolved: result.unresolved?.unresolved || [],
        cycles: result.cycles?.cycles || [],
      };
    }

    // surface: minimal AI-digestible summary (<150 tokens target)
    if (currentDepth === 'surface') {
      return {
        ok: true,
        severity: result.summary?.severity || 'low',
        counts: output.counts,
        topRisks: output.topRisks.slice(0, 3).map((r) => ({
          category: r.category,
          severity: r.severity,
          ...(r.count !== undefined ? { count: r.count } : {}),
        })),
      };
    }

    return output;
  }

  // Generate with token-budget-aware downgrading
  let output = buildOutput(depth);

  if (tokenBudget) {
    let estimatedTokens = JSON.stringify(output).length / AI_FORMAT.ESTIMATED_CHARS_PER_TOKEN;
    if (estimatedTokens > tokenBudget && depth !== 'surface') {
      output = buildOutput('surface');
      estimatedTokens = JSON.stringify(output).length / AI_FORMAT.ESTIMATED_CHARS_PER_TOKEN;
    }
    // If still over budget at surface, strip to core fields
    if (estimatedTokens > tokenBudget) {
      output = {
        ok: output.ok,
        severity: output.severity,
        counts: output.counts,
      };
    }
  }

  return JSON.stringify(output, null, 2);
}

function formatHuman(command, result) {
  if (!result || result.ok === false) {
    return `Error: ${result?.error || 'Command failed'}`;
  }
  switch (command) {
    case 'workspace-info':
      return [
        `workspaceRoot: ${result.workspaceRoot}`,
        `detected: ${Object.entries(result.detected).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none'}`,
      ].join('\n');
    case 'health':
      return [
        `workspaceRoot: ${result.workspaceRoot}`,
        `healthScore: ${result.healthScore}`,
        `packageManager: ${result.packageManager || 'unknown'}`,
        `ci: ${result.checks.ci.found ? 'yes' : 'no'}`,
        `tests: ${result.checks.testConfig.found ? result.checks.testConfig.frameworks.join(', ') : 'none'}`,
      ].join('\n');
    case 'audit-security': {
      if (result.summary?.message) {
        return result.summary.message;
      }
      return buildSecurityLines(result, 'human').join('\n');
    }
    case 'audit-summary':
      return formatAuditSummary(result, 'human');
    case 'audit-file':
      return [
        `file: ${result.file}`,
        `resolvedPath: ${result.resolvedPath}`,
        `severity: ${result.summary.severity}`,
        `impactCount: ${result.impact.impactCount}`,
        `affectedTestsCount: ${result.affectedTests.affectedTestsCount}`,
      ].join('\n');
    case 'audit-diff': {
      const topRisk = Array.isArray(result.changedFiles)
        ? result.changedFiles
            .filter((entry) => entry?.compositeRisk)
            .sort((a, b) => (b.compositeRisk.score || 0) - (a.compositeRisk.score || 0))[0]
        : null;
      const topRiskAction = Array.isArray(result.validationAdvice?.topRiskActions)
        ? result.validationAdvice.topRiskActions[0]
        : null;
      const lines = [
        `workspaceRoot: ${result.workspaceRoot}`,
        `severity: ${result.summary.severity}`,
        `changedFiles: ${result.summary.counts.changedFiles}`,
        `mainlineChangedFiles: ${result.summary.counts.mainlineChangedFiles}`,
        `affectedTests: ${result.summary.counts.affectedTests}`,
        `maxImpact: ${result.summary.counts.maxImpact}`,
        `highHistoryRiskFiles: ${result.summary.counts.highHistoryRiskFiles}`,
        `highCompositeRiskFiles: ${result.summary.counts.highCompositeRiskFiles}`,
        `fileTypeBreakdown: ${JSON.stringify(result.summary.fileTypeBreakdown)}`,
        `changeMetrics: ${result.summary.changeMetrics ? `+${result.summary.changeMetrics.totalAdditions}/-${result.summary.changeMetrics.totalDeletions}` : 'unavailable'}`,
        `topCompositeRisk: ${topRisk ? `${topRisk.file} (score=${topRisk.compositeRisk.score}, level=${topRisk.compositeRisk.level})` : 'none'}`,
        `topRiskAction: ${topRiskAction ? `${topRiskAction.file}: ${topRiskAction.actions[0]}` : 'none'}`,
        `topRiskCommand: ${topRiskAction?.suggestedCommand || 'none'}`,
        `validationPhases: ${result.validationAdvice.phases.length}`,
      ];
      if (result.incremental && result.incrementalFindings) {
        const inc = result.incrementalFindings;
        lines.push('', `--- incremental findings (related to changed files) ---`, `deadExports: ${inc.deadExportsCount}`, `unresolved: ${inc.unresolvedCount}`, `cycles: ${inc.cyclesCount}`);
        for (const de of inc.deadExports.slice(0, 3)) lines.push(`  dead-export: ${de.file}: ${de.exports?.join(', ') || 'n/a'}`);
        for (const u of inc.unresolved.slice(0, 3)) lines.push(`  unresolved: ${u.file}: ${u.import}`);
        for (const c of inc.cycles.slice(0, 3)) lines.push(`  cycle: ${c.join(' -> ')}`);
        if (inc.deadExportsCount + inc.unresolvedCount + inc.cyclesCount === 0) lines.push('  (none)');
      }
      return lines.join('\n');
    }
    case 'audit-overview': {
      const langSupport = result.languageSupport || {};
      const langSummary = Object.entries(langSupport)
        .map(([lang, info]) => `${lang}(${info.level}/${info.confidence})`)
        .join(', ');
      return [
        `workspaceRoot: ${result.workspaceRoot}`,
        `severity: ${result.summary?.severity || 'low'}`,
        `totalFiles: ${result.skeleton?.totalFiles ?? 0} (parseable source only; excludes assets/build artifacts/excluded dirs)`,
        `mainlineFiles: ${result.skeleton?.mainlineFiles ?? 0}`,
        `hotspotsHigh: ${result.aggregates?.hotspotsByRisk?.high ?? 0}`,
        `hotspotsMedium: ${result.aggregates?.hotspotsByRisk?.medium ?? 0}`,
        `fragileModules: ${result.aggregates?.stabilityCounts?.fragile ?? 0}`,
        `orphansTotal: ${result.orphans?.counts?.total ?? 0}`,
        `languages: ${langSummary || 'none detected'}`,
      ].join('\n');
    }
    case 'audit-map': {
      if (result.summary) {
        return [
          `severity: ${result.summary.severity}`,
          `files: ${countTreeFiles(result.tree)}`,
          `edges: ${result.edges?.length ?? 0}`,
          `unresolved: ${result.issueOverlay?.unresolved?.length ?? 0}`,
          `cycles: ${result.issueOverlay?.cycles?.length ?? 0}`,
          `deadExports: ${result.issueOverlay?.deadExports?.length ?? 0}`,
          `orphans: ${result.issueOverlay?.orphans?.length ?? 0}`,
          `hotspots: ${result.issueOverlay?.hotspots?.length ?? 0}`,
          `next: ${result.summary.nextSteps[0]}`,
        ].join('\n');
      }
      return [
        `workspaceRoot: ${result.workspaceRoot}`,
        `files: ${countTreeFiles(result.tree)}`,
        `edges: ${result.edges?.length ?? 0}`,
        `deadExports: ${result.issueOverlay?.deadExports?.length ?? 0}`,
        `unresolved: ${result.issueOverlay?.unresolved?.length ?? 0}`,
        `cycles: ${result.issueOverlay?.cycles?.length ?? 0}`,
        `orphans: ${result.issueOverlay?.orphans?.length ?? 0}`,
        `hotspots: ${result.issueOverlay?.hotspots?.length ?? 0}`,
      ].join('\n');
    }
    case 'stats':
      return Object.entries(result.stats || {})
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n');
    case 'dependencies':
      return [
        `file: ${result.file}`,
        `dependenciesCount: ${result.dependenciesCount}`,
        ...result.dependencies.map((d) => `  → ${d}`),
      ].join('\n');
    case 'dependents':
      return [
        `file: ${result.file}`,
        `dependentsCount: ${result.dependentsCount}`,
        ...result.dependents.map((d) => `  ← ${d}`),
      ].join('\n');
    case 'dead-exports': {
      const lines = [
        `deadExportsCount: ${result.deadExportsCount}`,
      ];
      if (result.possibleFalsePositives?.disclaimer) {
        lines.push(`note: ${result.possibleFalsePositives.disclaimer}`);
      }
      lines.push(...result.deadExports.map((entry) => `${entry.file}: ${entry.exports.join(', ')}`));
      return lines.join('\n');
    }
    case 'unresolved': {
      const lines = [
        `unresolvedCount: ${result.unresolvedCount}`,
      ];
      if (result.possibleFalsePositives?.disclaimer) {
        lines.push(`note: ${result.possibleFalsePositives.disclaimer}`);
      }
      lines.push(...result.unresolved.map((entry) => `${entry.file}: ${entry.import}`));
      return lines.join('\n');
    }
    case 'cycles':
      return [
        `cyclesCount: ${result.cyclesCount}`,
        ...result.cycles.map((cycle) => cycle.join(' -> ')),
      ].join('\n');
    case 'impact':
      return [
        `impactCount: ${result.impactCount}`,
        ...result.impact.map((entry) => {
          const viaStr = entry.via && entry.via.length > 1
            ? ` via ${entry.via.slice(1).join(' -> ')}`
            : '';
          return `${entry.level}: ${entry.file}${viaStr}`;
        }),
      ].join('\n');
    case 'affected-tests':
      return [
        `affectedTestsCount: ${result.affectedTestsCount}`,
        ...result.affectedTests.map((entry) => {
          const viaStr = entry.via?.length > 0 ? ` via ${entry.via.join(' -> ')}` : '';
          return `${entry.distance}: ${entry.file}${viaStr}`;
        }),
      ].join('\n');
    case 'diagnostics': {
      const diagTotal = result.diagnosticsSummary?.noLintersDetected
        ? 'no linters detected'
        : result.diagnosticsSummary?.total;
      return [
        `checksRun: ${result.checksRun}`,
        `failedChecks: ${result.failedChecks.join(', ') || 'none'}`,
        `diagnostics: ${diagTotal}`,
      ].join('\n');
    }
    case 'tree': {
      const lines = [`file: ${result.file}`];
      function render(node, prefix = '') {
        if (node.imports) {
          for (const imp of node.imports) {
            const tag = imp.external ? ' [external]' : (imp.circular ? ' [circular]' : '');
            lines.push(`${prefix}→ ${imp.file}${tag}`);
            if (imp.imports || imp.dependents) {
              render(imp, prefix + '  ');
            }
          }
        }
        if (node.dependents) {
          for (const dep of node.dependents) {
            const tag = dep.circular ? ' [circular]' : '';
            lines.push(`${prefix}← ${dep.file}${tag}`);
            if (dep.imports || dep.dependents) {
              render(dep, prefix + '  ');
            }
          }
        }
      }
      if (result.tree) {
        render(result.tree);
      }
      return lines.join('\n');
    }
    default:
      return JSON.stringify(result, null, 2);
  }
}

function formatJsonl(command, result) {
  if (!result || result.ok === false) {
    return JSON.stringify({ _type: 'error', error: result?.error || 'Command failed' });
  }

  const records = [];
  const push = (type, arr) => {
    if (Array.isArray(arr)) {
      for (const item of arr) {
        if (item && typeof item === 'object') {
          records.push({ _type: type, ...item });
        } else {
          records.push({ _type: type, value: item });
        }
      }
    }
  };

  switch (command) {
    case 'audit-security':
      push('finding', result.findings);
      break;
    case 'dead-exports':
      push('dead-export', result.deadExports);
      break;
    case 'unresolved':
      push('unresolved', result.unresolved);
      break;
    case 'cycles':
      push('cycle', result.cycles);
      break;
    case 'audit-diff': {
      push('changed-file', result.changedFiles);
      push('finding', result.findings);
      break;
    }
    case 'audit-summary': {
      push('dead-export', result.deadExports?.deadExports);
      push('unresolved', result.unresolved?.unresolved);
      push('cycle', result.cycles?.cycles);
      break;
    }
    case 'audit-overview': {
      push('hotspot', result.hotspots);
      push('stability', result.stability);
      push('orphan', result.orphans?.samples?.modules);
      break;
    }
    case 'impact':
      push('impact', result.impact);
      break;
    case 'dependents':
      push('dependent', result.dependents);
      break;
    case 'dependencies':
      push('dependency', result.dependencies);
      break;
    case 'affected-tests':
      push('affected-test', result.affectedTests);
      break;
    case 'audit-map': {
      push('highlighted-file', result.highlightedFiles);
      push('edge', result.edges);
      break;
    }
    case 'health':
      push('check', result.checks);
      break;
    case 'diagnostics':
      push('diagnostic', result.results);
      break;
    default:
      records.push({ _type: command, ...result });
  }

  if (records.length === 0) {
    records.push({
      _type: 'summary',
      ok: result.ok,
      command,
      severity: result.severity || result.summary?.severity,
    });
  }

  return records.map((r) => JSON.stringify(r)).join('\n');
}

module.exports = { formatHuman, formatSummary, formatMarkdown, formatJsonl, formatAi, formatAuditSummary };
