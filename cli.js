#!/usr/bin/env node
/**
 * workspace-bridge CLI
 *
 * Keeps the existing analysis engine behind a local CLI so agents
 * can call it directly.
 */
const { ServiceContainer } = require('./src/services/container');
const { workspaceInfo, runDiagnostics } = require('./src/tools/workspace-tools');
const { projectHealth, checkDependencies } = require('./src/tools/health-tools');
const { dependencyGraph } = require('./src/tools/dep-tools');
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
} = require('./src/cli/audit-formatters');
const { buildProjectOverview } = require('./src/tools/overview-tools');

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
  health                  Summarize project health
  deps                    List outdated dependencies
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

function parseArgs(argv) {
  const args = argv.slice(2);
  let command = null;
  let startIndex = 0;
  if (args[0] && !args[0].startsWith('-')) {
    command = args[0];
    startIndex = 1;
  }
  const parsed = {
    command,
    cwd: process.cwd(),
    exclude: [],
    mode: 'quick',
    file: null,
    maxDepth: null,
    reuseHints: 'off',
    hotspotData: null,
    stabilityTrendData: null,
    trendGranularity: 'day',
    overviewDashboard: null,
    json: false,
    quiet: false,
    help: false,
  };

  for (let i = startIndex; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case '--cwd':
        parsed.cwd = args[++i] || parsed.cwd;
        break;
      case '--exclude':
        parsed.exclude = (args[++i] || '')
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean);
        break;
      case '--mode':
        parsed.mode = args[++i] || parsed.mode;
        break;
      case '--file':
        parsed.file = args[++i] || null;
        break;
      case '--max-depth':
        parsed.maxDepth = Number.parseInt(args[++i] || '', 10);
        break;
      case '--reuse-hints':
        parsed.reuseHints = (args[++i] || parsed.reuseHints).toLowerCase();
        if (!['on', 'off'].includes(parsed.reuseHints)) {
          throw new Error(`Invalid --reuse-hints value: ${parsed.reuseHints}. Expected on|off`);
        }
        break;
      case '--hotspot-data':
        parsed.hotspotData = args[++i] || null;
        break;
      case '--stability-trend-data':
        parsed.stabilityTrendData = args[++i] || null;
        break;
      case '--trend-granularity':
        parsed.trendGranularity = (args[++i] || parsed.trendGranularity).toLowerCase();
        if (!['day', 'week'].includes(parsed.trendGranularity)) {
          throw new Error(`Invalid --trend-granularity value: ${parsed.trendGranularity}. Expected day|week`);
        }
        break;
      case '--overview-dashboard':
        parsed.overviewDashboard = args[++i] || null;
        break;
      case '--json':
        parsed.json = true;
        break;
      case '--quiet':
        parsed.quiet = true;
        break;
      case '--help':
      case '-h':
        parsed.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function requireFile(parsed, command) {
  if (!parsed.file) {
    throw new Error(`${command} requires --file <path>`);
  }
}

function formatHuman(command, result) {
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
    case 'audit-overview':
      return [
        `workspaceRoot: ${result.workspaceRoot}`,
        `severity: ${result.summary?.severity || 'low'}`,
        `totalFiles: ${result.skeleton?.totalFiles ?? 0}`,
        `mainlineFiles: ${result.skeleton?.mainlineFiles ?? 0}`,
        `hotspotsHigh: ${result.aggregates?.hotspotsByRisk?.high ?? 0}`,
        `hotspotsMedium: ${result.aggregates?.hotspotsByRisk?.medium ?? 0}`,
        `fragileModules: ${result.aggregates?.stabilityCounts?.fragile ?? 0}`,
        `orphansTotal: ${result.orphans?.counts?.total ?? 0}`,
      ].join('\n');
    case 'deps':
      return result.results.map((entry) => {
        if (entry.skipped) return `${entry.tool}: skipped (${entry.reason})`;
        return `${entry.tool}: ${entry.outdatedCount} outdated`;
      }).join('\n');
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

      const entries = await mapWithConcurrency(changed.changedFiles, 8, async (relativeFile) => {
        const resolvedPath = validateWorkspacePath(relativeFile, container.workspaceRoot);
        const classification = container.projectContext?.classifyFile(resolvedPath) || null;
        const graphKnown = Boolean(resolvedPath && container.depGraph.hasFile(resolvedPath));
        const impact = graphKnown ? container.depGraph.getImpactRadius(resolvedPath) : [];
        const lineRangeResult = resolvedPath
          ? await getChangedLineRanges(container.workspaceRoot, resolvedPath, { staged: false })
          : { ok: false };
        const changedLineRanges = lineRangeResult.ok ? lineRangeResult.lineRanges : [];
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
              maxDepth: Number.isFinite(parsed.maxDepth) ? parsed.maxDepth : 4,
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
        const history = resolvedPath ? await getFileHistoryRisk(container.workspaceRoot, resolvedPath, { limit: 25 }) : { ok: false };
        const historyRisk = history.ok ? history.historyRisk : null;
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
    case 'health':
      return projectHealth({ cwd: parsed.cwd }, container);
    case 'deps':
      return checkDependencies({ cwd: parsed.cwd }, container);
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
    parsed = parseArgs(process.argv);
  } catch (err) {
    console.error(err.message);
    printUsage();
    process.exit(1);
  }

  if (parsed.help || !parsed.command) {
    printUsage();
    return;
  }

  const container = new ServiceContainer();
  const originalConsoleError = console.error;

  if (parsed.quiet) {
    console.error = () => {};
  }

  try {
    const initialized = await container.initialize(parsed.cwd, 60000, {
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
    console.error(err.message || String(err));
    process.exitCode = 1;
  } finally {
    await container.shutdown();
    console.error = originalConsoleError;
  }
}

main();

