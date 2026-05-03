#!/usr/bin/env node
/**
 * workspace-bridge CLI
 *
 * Keeps the existing analysis engine behind a local CLI so agents
 * can call it directly.
 */
const fs = require('fs');
const { ServiceContainer } = require('./src/services/container');
const { workspaceInfo, runDiagnostics } = require('./src/tools/workspace-tools');
const { projectHealth } = require('./src/tools/health-tools');
const { dependencyGraph } = require('./src/tools/dep-tools');
const { auditSecurity } = require('./src/tools/security-tools');
const { getChangedFiles } = require('./src/tools/git-tools');
const { getChangedLineRanges } = require('./src/tools/git-tools');
const { validateWorkspacePath } = require('./src/tools/git-tools');
const { getFileHistoryRisk } = require('./src/tools/git-tools');
const {
  buildCompositeRisk,
  buildRepoSummary,
  buildFileSummary,
  buildAuditDiffSummary,
  buildValidationAdvice,
  buildProjectMap,
  buildImpactExplanations,
} = require('./src/cli/formatters');
const { buildProjectOverview } = require('./src/tools/overview-tools');
const { parseArgs } = require('./src/utils/parse-args');
const { TIMEOUTS, DEFAULTS } = require('./src/config/constants');

async function mapWithConcurrency(items, limit, mapper) {
  const safeLimit = Math.max(1, Number.isFinite(limit) ? limit : 1);
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const currentIndex = cursor;
      cursor += 1;
      try {
        results[currentIndex] = await mapper(items[currentIndex], currentIndex);
      } catch (err) {
        results[currentIndex] = {
          __error: err?.message || String(err),
          __item: items[currentIndex],
        };
      }
    }
  }

  const workers = [];
  const workerCount = Math.min(safeLimit, items.length);
  for (let i = 0; i < workerCount; i += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

function printUsage() {
  console.log(`workspace-bridge-cli

Usage:
  workspace-bridge-cli <command> [options]

Commands:
  workspace-info           Detect workspace type and root
  diagnostics             Run quick/full diagnostics
  audit-summary           Aggregate health + graph findings
  audit-file --file <p>   Aggregate impact + affected tests for one file
  audit-diff             Aggregate changed files + impact + affected tests
  audit-overview         Project panoramic view (hotspots, stability, orphans)
  audit-map              Global project map (tree + edges + issue overlay)
  health                  Summarize project health
  audit-security          Run external security scanners (Semgrep, CodeQL)
  repl                    Start interactive REPL shell
  watch                   Watch files and print impact on save
  stats                   Show dependency graph statistics
  dependencies --file <p> List direct dependencies of a file
  dependents --file <p>   List direct dependents of a file
  dead-exports            Find dead export candidates
  unresolved              Find unresolved imports
  cycles                  Find circular dependencies
  impact --file <path>    Find impact radius for a file
  affected-tests --file <path> [--max-depth <n>]

Options:
  --cwd <path>            Target workspace or file path
  --exclude <paths>       Comma-separated directories or path fragments to exclude
  --mode <quick|full>     Diagnostics mode
  --file <path>           File path for file-scoped commands
  --max-depth <n>         Max depth for affected-tests
  --reuse-hints <mode>    Reuse hints mode for audit-diff: on|off (default: off)
  --hotspot-data <path>   Write audit-overview hotspot visualization JSON
  --stability-trend-data <path>  Write audit-overview stability trend JSON
  --trend-granularity <mode>  Trend bucket mode for stability trend: day|week (default: day)
  --overview-dashboard <path>  Write audit-overview single-file HTML dashboard
  --json                  Print machine-readable JSON
  --quiet                 Suppress stderr logs during CLI execution
  --help                  Show help
`);
}

function parseCliArgs(argv) {
  const raw = parseArgs(argv, {
    '--cwd': { key: 'cwd' },
    '--exclude': { key: 'exclude' },
    '--mode': { key: 'mode' },
    '--file': { key: 'file' },
    '--max-depth': { key: 'maxDepth', transform: (v) => Number.parseInt(v, 10) },
    '--reuse-hints': { key: 'reuseHints' },
    '--hotspot-data': { key: 'hotspotData' },
    '--stability-trend-data': { key: 'stabilityTrendData' },
    '--trend-granularity': { key: 'trendGranularity' },
    '--overview-dashboard': { key: 'overviewDashboard' },
    '--config': { key: 'config' },
    '--language': { key: 'language' },
    '--db-path': { key: 'dbPath' },
    '--force-refresh': true,
    '--json': true,
    '--quiet': true,
    '--help': true,
    '-h': true,
  });

  const command = raw._[0] || null;
  const reuseHints = (raw.reuseHints || 'off').toLowerCase();
  if (reuseHints && !['on', 'off'].includes(reuseHints)) {
    throw new Error(`Invalid --reuse-hints value: ${reuseHints}. Expected on|off`);
  }
  const trendGranularity = (raw.trendGranularity || 'day').toLowerCase();
  if (trendGranularity && !['day', 'week'].includes(trendGranularity)) {
    throw new Error(`Invalid --trend-granularity value: ${trendGranularity}. Expected day|week`);
  }

  return {
    command,
    cwd: raw.cwd || process.cwd(),
    exclude: raw.exclude
      ? String(raw.exclude)
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
      : [],
    mode: raw.mode || 'quick',
    file: raw.file || null,
    maxDepth: Number.isFinite(raw.maxDepth) ? raw.maxDepth : null,
    reuseHints,
    hotspotData: raw.hotspotData || null,
    stabilityTrendData: raw.stabilityTrendData || null,
    trendGranularity,
    overviewDashboard: raw.overviewDashboard || null,
    config: raw.config || null,
    language: raw.language || null,
    dbPath: raw.dbPath || null,
    forceRefresh: Boolean(raw['--force-refresh']),
    targets: raw._.slice(1),
    json: Boolean(raw['--json']),
    quiet: Boolean(raw['--quiet']),
    help: Boolean(raw['--help']) || Boolean(raw['-h']),
  };
}

function requireFile(parsed, command) {
  if (!parsed.file) {
    throw new Error(`${command} requires --file <path>`);
  }
}

function countTreeFiles(tree) {
  if (!Array.isArray(tree)) return 0;
  let count = 0;
  for (const node of tree) {
    if (node.type === 'file') count += 1;
    if (node.type === 'directory' && Array.isArray(node.children)) {
      count += countTreeFiles(node.children);
    }
  }
  return count;
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
    case 'audit-summary':
      return [
        `workspaceRoot: ${result.workspaceRoot}`,
        `severity: ${result.summary.severity}`,
        `healthScore: ${result.health.healthScore}`,
        `mainlineFiles: ${result.scope.counts.mainlineFiles}`,
        `nonMainlineFiles: ${result.scope.counts.nonMainlineFiles}`,
        `deadExportCount: ${result.deadExports.deadExportCount}`,
        `unresolvedCount: ${result.unresolved.unresolvedCount}`,
        `cycleCount: ${result.cycles.cycleCount}`,
      ].join('\n');
    case 'audit-file':
      return [
        `file: ${result.file}`,
        `resolvedPath: ${result.resolvedPath}`,
        `severity: ${result.summary.severity}`,
        `impactCount: ${result.impact.impactCount}`,
        `affectedTestCount: ${result.affectedTests.affectedTestCount}`,
      ].join('\n');
    case 'audit-diff':
      {
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
        `totalFiles: ${result.skeleton?.totalFiles ?? 0}`,
        `mainlineFiles: ${result.skeleton?.mainlineFiles ?? 0}`,
        `hotspotsHigh: ${result.aggregates?.hotspotsByRisk?.high ?? 0}`,
        `hotspotsMedium: ${result.aggregates?.hotspotsByRisk?.medium ?? 0}`,
        `fragileModules: ${result.aggregates?.stabilityCounts?.fragile ?? 0}`,
        `orphansTotal: ${result.orphans?.counts?.total ?? 0}`,
        `languages: ${langSummary || 'none detected'}`,
      ].join('\n');
    }
    case 'audit-map':
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
    case 'stats':
      return Object.entries(result.stats || {})
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n');
    case 'dependencies':
      return [
        `file: ${result.file}`,
        `dependencyCount: ${result.dependencyCount}`,
        ...result.dependencies.map((d) => `  → ${d}`),
      ].join('\n');
    case 'dependents':
      return [
        `file: ${result.file}`,
        `dependentCount: ${result.dependentCount}`,
        ...result.dependents.map((d) => `  ← ${d}`),
      ].join('\n');
    case 'dead-exports':
      return [
        `deadExportCount: ${result.deadExportCount}`,
        ...result.deadExports.map((entry) => `${entry.file}: ${entry.exports.join(', ')}`),
      ].join('\n');
    case 'unresolved':
      return [
        `unresolvedCount: ${result.unresolvedCount}`,
        ...result.unresolved.map((entry) => `${entry.file}: ${entry.import}`),
      ].join('\n');
    case 'cycles':
      return [
        `cycleCount: ${result.cycleCount}`,
        ...result.cycles.map((cycle) => cycle.join(' -> ')),
      ].join('\n');
    case 'impact':
      return [
        `impactCount: ${result.impactCount}`,
        ...result.impact.map((entry) => `${entry.level}: ${entry.file}`),
      ].join('\n');
    case 'affected-tests':
      return [
        `affectedTestCount: ${result.affectedTestCount}`,
        ...result.affectedTests.map((entry) => `${entry.distance}: ${entry.file}`),
      ].join('\n');
    case 'diagnostics':
      return [
        `checksRun: ${result.checksRun}`,
        `failedChecks: ${result.failedChecks.join(', ') || 'none'}`,
        `diagnostics: ${result.diagnosticsSummary.total}`,
      ].join('\n');
    default:
      return JSON.stringify(result, null, 2);
  }
}

async function runCommand(parsed, container) {
  switch (parsed.command) {
    case 'workspace-info':
      return workspaceInfo({ cwd: parsed.cwd }, container);
    case 'diagnostics':
      return runDiagnostics({ cwd: parsed.cwd, mode: parsed.mode }, container);
    case 'audit-summary': {
      const [health, deadExports, unresolved, cycles] = await Promise.all([
        projectHealth({ cwd: parsed.cwd }, container),
        dependencyGraph({ cwd: parsed.cwd, operation: 'dead_exports' }, container),
        dependencyGraph({ cwd: parsed.cwd, operation: 'unresolved' }, container),
        dependencyGraph({ cwd: parsed.cwd, operation: 'cycles' }, container),
      ]);
      const scope = container.depGraph.getScopeSummary();
      return {
        ok: [health, deadExports, unresolved, cycles].every((result) => result.ok !== false),
        workspaceRoot: container.workspaceRoot,
        scope,
        summary: buildRepoSummary(health, deadExports, unresolved, cycles, scope),
        health,
        deadExports,
        unresolved,
        cycles,
      };
    }
    case 'audit-file': {
      requireFile(parsed, 'audit-file');
      const resolvedPath = validateWorkspacePath(parsed.file, container.workspaceRoot);
      if (!resolvedPath || !fs.existsSync(resolvedPath)) {
        return { ok: false, error: `File not found: ${parsed.file}`, inProject: false };
      }
      const [impact, affectedTests] = await Promise.all([
        dependencyGraph({ cwd: parsed.cwd, operation: 'impact', file: parsed.file }, container),
        dependencyGraph({
          cwd: parsed.cwd,
          operation: 'affected_tests',
          file: parsed.file,
          maxDepth: Number.isFinite(parsed.maxDepth) ? parsed.maxDepth : undefined,
        }, container),
      ]);
      return {
        ok: impact.ok !== false && affectedTests.ok !== false,
        workspaceRoot: container.workspaceRoot,
        file: parsed.file,
        resolvedPath: impact.resolvedPath || affectedTests.resolvedPath || null,
        summary: buildFileSummary(impact, affectedTests),
        impact,
        affectedTests,
      };
    }
    case 'audit-diff': {
      const changed = await getChangedFiles(container.workspaceRoot, { staged: false, includeUntracked: true });
      if (changed.ok === false) {
        return changed;
      }

      const entries = await mapWithConcurrency(changed.changedFiles, DEFAULTS.CLI_CONCURRENCY, async (relativeFile) => {
        const resolvedPath = validateWorkspacePath(relativeFile, container.workspaceRoot);
        const classification = container.projectContext?.classifyFile(resolvedPath) || null;
        const graphKnown = Boolean(resolvedPath && container.depGraph.hasFile(resolvedPath));
        const impact = graphKnown ? container.depGraph.getImpactRadius(resolvedPath) : [];
        let changedLineRanges = [];
        if (resolvedPath) {
          const [unstagedResult, stagedResult] = await Promise.all([
            getChangedLineRanges(container.workspaceRoot, resolvedPath, { staged: false }).catch(() => ({ ok: false })),
            getChangedLineRanges(container.workspaceRoot, resolvedPath, { staged: true }).catch(() => ({ ok: false })),
          ]);
          const ranges = [];
          if (unstagedResult.ok) ranges.push(...unstagedResult.lineRanges);
          if (stagedResult.ok) ranges.push(...stagedResult.lineRanges);
          const seen = new Set();
          changedLineRanges = ranges.filter((r) => {
            const key = `${r.startLine}-${r.endLine}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          }).sort((a, b) => a.startLine - b.startLine);
        }
        const baseSymbolImpact = graphKnown ? container.depGraph.getSymbolImpact(resolvedPath) : null;
        const changedFunctionImpactBase = graphKnown
          ? container.depGraph.getChangedFunctionImpact(resolvedPath, changedLineRanges, { symbolImpact: baseSymbolImpact })
          : null;
        let reuseHints = [];
        if (parsed.reuseHints === 'on' && graphKnown && changedFunctionImpactBase?.mode === 'function-symbol') {
          try {
            reuseHints = container.depGraph.getFunctionReuseHints(resolvedPath, changedFunctionImpactBase.changedFunctions, {
              minScore: 0.5,
              maxPerFunction: 3,
            });
          } catch (e) {
            // Non-core path: similarity hints should never block main diff analysis.
            if (!parsed.quiet) {
              console.error(`[warn] reuse hints failed for ${relativeFile}: ${e?.message || String(e)}`);
            }
            reuseHints = [];
          }
        }
        const functionLevelAffectedTests = graphKnown &&
          (changedFunctionImpactBase?.mode === 'function-symbol' || changedFunctionImpactBase?.mode === 'internal-function-call-chain')
          ? container.depGraph.getFunctionLevelAffectedTests(
            resolvedPath,
            changedFunctionImpactBase.changedFunctions,
            {
              symbolImpact: baseSymbolImpact,
              maxDepth: Number.isFinite(parsed.maxDepth) ? parsed.maxDepth : DEFAULTS.SYMBOL_IMPACT_DEPTH,
            }
          )
          : { functions: [], affectedTestCount: 0 };
        const changedFunctionImpact = changedFunctionImpactBase
          ? { ...changedFunctionImpactBase, reuseHints, functionLevelAffectedTests }
          : null;
        const symbolImpact = baseSymbolImpact
          ? { ...baseSymbolImpact, changedFunctionImpact }
          : null;
        const affectedTests = graphKnown ? container.depGraph.findAffectedTests(resolvedPath, Number.isFinite(parsed.maxDepth) ? parsed.maxDepth : undefined) : [];
        const history = resolvedPath ? await getFileHistoryRisk(container.workspaceRoot, resolvedPath, { limit: DEFAULTS.HISTORY_LIMIT }) : { ok: false };
        const historyRisk = history.ok ? history.historyRisk : null;
        const impactExplanations = graphKnown
          ? buildImpactExplanations({ file: relativeFile, impact })
          : [];
        const baseEntry = {
          file: relativeFile,
          resolvedPath,
          classification,
          graphKnown,
          impactCount: impact.length,
          impact,
          changedLineRanges,
          symbolImpact,
          affectedTestCount: affectedTests.length,
          affectedTests,
          historyRisk,
          recentCommits: history.ok ? history.recentCommits : [],
          impactExplanations,
        };
        const compositeRisk = buildCompositeRisk(baseEntry);

        return {
          ...baseEntry,
          compositeRisk,
        };
      });
      const safeEntries = entries.map((entry, index) => {
        if (!entry?.__error) return entry;
        const baseEntry = {
          file: changed.changedFiles[index],
          resolvedPath: null,
          classification: null,
          graphKnown: false,
          impactCount: 0,
          impact: [],
          changedLineRanges: [],
          symbolImpact: null,
          affectedTestCount: 0,
          affectedTests: [],
          historyRisk: null,
          recentCommits: [],
          processingError: entry.__error,
        };
        return {
          ...baseEntry,
          compositeRisk: buildCompositeRisk(baseEntry),
        };
      });

      return {
        ok: true,
        workspaceRoot: container.workspaceRoot,
        scope: container.depGraph.getScopeSummary(),
        summary: buildAuditDiffSummary(safeEntries),
        validationAdvice: buildValidationAdvice(safeEntries, container.workspaceRoot),
        options: {
          reuseHints: parsed.reuseHints,
        },
        changedFiles: safeEntries,
      };
    }
    case 'audit-overview':
      return buildProjectOverview(parsed, container);
    case 'audit-map': {
      await container.ensureReady();
      return buildProjectMap(container.depGraph);
    }
    case 'health':
      return projectHealth({ cwd: parsed.cwd }, container);
    case 'audit-security':
      return auditSecurity({ cwd: parsed.cwd, targets: parsed.targets, config: parsed.config, language: parsed.language, dbPath: parsed.dbPath, forceRefresh: parsed.forceRefresh }, container);
    case 'stats':
      return dependencyGraph({ cwd: parsed.cwd, operation: 'stats' }, container);
    case 'dependencies':
      requireFile(parsed, 'dependencies');
      return dependencyGraph({ cwd: parsed.cwd, operation: 'dependencies', file: parsed.file }, container);
    case 'dependents':
      requireFile(parsed, 'dependents');
      return dependencyGraph({ cwd: parsed.cwd, operation: 'dependents', file: parsed.file }, container);
    case 'dead-exports':
      return dependencyGraph({ cwd: parsed.cwd, operation: 'dead_exports' }, container);
    case 'unresolved':
      return dependencyGraph({ cwd: parsed.cwd, operation: 'unresolved' }, container);
    case 'cycles':
      return dependencyGraph({ cwd: parsed.cwd, operation: 'cycles' }, container);
    case 'impact':
      requireFile(parsed, 'impact');
      return dependencyGraph({ cwd: parsed.cwd, operation: 'impact', file: parsed.file }, container);
    case 'affected-tests':
      requireFile(parsed, 'affected-tests');
      return dependencyGraph({
        cwd: parsed.cwd,
        operation: 'affected_tests',
        file: parsed.file,
        maxDepth: Number.isFinite(parsed.maxDepth) ? parsed.maxDepth : undefined,
      }, container);
    default:
      throw new Error(`Unknown command: ${parsed.command}`);
  }
}

async function main() {
  let parsed;
  try {
    parsed = parseCliArgs(process.argv);
  } catch (err) {
    console.error(err.message);
    printUsage();
    process.exit(1);
  }

  if (parsed.help || !parsed.command) {
    printUsage();
    return;
  }

  if (parsed.command === 'repl') {
    const { startRepl } = require('./src/cli/repl');
    await startRepl({ cwd: parsed.cwd, exclude: parsed.exclude, quiet: parsed.quiet });
    return;
  }

  if (parsed.command === 'watch') {
    const { startWatch } = require('./src/cli/watch');
    await startWatch({ cwd: parsed.cwd, exclude: parsed.exclude });
    return;
  }

  const container = new ServiceContainer();
  const originalConsoleError = console.error;

  if (parsed.quiet) {
    console.error = () => {};
  }

  try {
    const initialized = await container.initialize(parsed.cwd, TIMEOUTS.INIT_TIMEOUT_MS, {
      watch: false,
      excludeDirs: parsed.exclude,
    });
    if (!initialized) {
      throw container.initError || new Error('Failed to initialize workspace container');
    }

    const result = await runCommand(parsed, container);
    if (parsed.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatHuman(parsed.command, result));
    }

    if (result && result.ok === false) {
      process.exitCode = 1;
    }
  } catch (err) {
    originalConsoleError(err.message || String(err));
    process.exitCode = 1;
  } finally {
    await container.shutdown();
    console.error = originalConsoleError;
  }
}

main();

