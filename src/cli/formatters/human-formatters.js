/**
 * Human-readable formatters for CLI commands.
 * Extracted from cli.js to reduce the facade thickness.
 */
const { countTreeFiles } = require('./project-map');

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
      if (result.summary.message) {
        return result.summary.message;
      }
      const lines = [
        `adapters: ${result.adapters.join(', ') || 'none'}`,
        `findings: ${result.summary.total}`,
        `severity: high=${result.summary.bySeverity.high} medium=${result.summary.bySeverity.medium} low=${result.summary.bySeverity.low}`,
      ];
      if (result.findings.length > 0) {
        lines.push('');
        for (const f of result.findings.slice(0, 20)) {
          lines.push(`[${f.severity.toUpperCase()}] ${f.ruleId} — ${f.file}${f.lineStart ? ':' + f.lineStart : ''}`);
          if (f.message) lines.push(`  ${f.message}`);
        }
        if (result.findings.length > 20) {
          lines.push(`... and ${result.findings.length - 20} more`);
        }
      }
      return lines.join('\n');
    }
    case 'audit-summary': {
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
      return [
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
      ].join('\n');
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
    default:
      return JSON.stringify(result, null, 2);
  }
}

module.exports = { formatHuman };
