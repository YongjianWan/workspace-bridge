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
const { validateWorkspacePath } = require('./src/tools/git-tools');
const { getFileHistoryRisk } = require('./src/tools/git-tools');

function toNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function buildRepoSummary(health, deadExports, unresolved, cycles, scope) {
  const deadExportCount = toNumber(deadExports.deadExportCount);
  const unresolvedCount = toNumber(unresolved.unresolvedCount);
  const cycleCount = toNumber(cycles.cycleCount);
  const nonMainlineFiles = toNumber(scope?.counts?.nonMainlineFiles);

  const scoreParts = String(health.healthScore || '0/5').split('/');
  const passedChecks = Number.parseInt(scoreParts[0] || '0', 10) || 0;
  const totalChecks = Number.parseInt(scoreParts[1] || '5', 10) || 5;
  const missingHygieneChecks = Math.max(0, totalChecks - passedChecks);

  let severity = 'low';
  if (unresolvedCount > 0 || cycleCount > 0) {
    severity = 'high';
  } else if (deadExportCount > 0 || missingHygieneChecks >= 3) {
    severity = 'medium';
  }

  const nextSteps = [];
  if (unresolvedCount > 0) nextSteps.push('Inspect unresolved imports first; they can indicate broken code paths or unsupported alias resolution.');
  if (cycleCount > 0) nextSteps.push('Break dependency cycles before making broad refactors.');
  if (deadExportCount > 0) nextSteps.push('Review dead exports as candidates, not automatic deletions.');
  if (missingHygieneChecks > 0) nextSteps.push('Close basic project hygiene gaps: LICENSE, CI, test config, env example, or editorconfig.');
  if (nonMainlineFiles > 0) nextSteps.push('Review the mainline/non-mainline split before trusting structural findings in mixed repositories.');
  if (nextSteps.length === 0) nextSteps.push('No immediate structural issues detected by the aggregate audit.');

  return {
    severity,
    counts: {
      deadExports: deadExportCount,
      unresolved: unresolvedCount,
      cycles: cycleCount,
      missingHygieneChecks,
    },
    nextSteps,
  };
}

function buildFileSummary(impact, affectedTests) {
  const impactCount = toNumber(impact.impactCount);
  const affectedTestCount = toNumber(affectedTests.affectedTestCount);

  let severity = 'low';
  if (impactCount >= 10 || affectedTestCount >= 5) {
    severity = 'high';
  } else if (impactCount > 0 || affectedTestCount > 0) {
    severity = 'medium';
  }

  const nextSteps = [];
  if (impactCount > 0) nextSteps.push('Review direct and transitive dependents before changing this file.');
  if (affectedTestCount > 0) nextSteps.push('Run the affected tests after the change.');
  if (nextSteps.length === 0) nextSteps.push('No dependent files or affected tests were detected by the graph.');

  return {
    severity,
    counts: {
      impact: impactCount,
      affectedTests: affectedTestCount,
    },
    nextSteps,
  };
}

function buildAuditDiffSummary(entries) {
  const mainlineChanged = entries.filter((entry) => entry.classification?.isMainline);
  const affectedTests = new Set();
  let maxImpact = 0;
  let highRiskFiles = 0;
  let highHistoryRiskFiles = 0;
  let maxHistoryRiskScore = 0;

  for (const entry of entries) {
    maxImpact = Math.max(maxImpact, toNumber(entry.impactCount));
    if (toNumber(entry.impactCount) >= 10 || toNumber(entry.affectedTestCount) >= 5) {
      highRiskFiles += 1;
    }
    const historyRiskScore = toNumber(entry.historyRisk?.score);
    maxHistoryRiskScore = Math.max(maxHistoryRiskScore, historyRiskScore);
    if (entry.historyRisk?.level === 'high') {
      highHistoryRiskFiles += 1;
    }
    for (const testFile of entry.affectedTests || []) {
      affectedTests.add(testFile.file);
    }
  }

  let severity = 'low';
  if (highRiskFiles > 0 || affectedTests.size >= 5 || highHistoryRiskFiles > 0) {
    severity = 'high';
  } else if (mainlineChanged.length > 0 && (affectedTests.size > 0 || maxImpact > 0 || maxHistoryRiskScore >= 3)) {
    severity = 'medium';
  }

  const nextSteps = [];
  if (mainlineChanged.length > 0) nextSteps.push('Review changed mainline files before merging.');
  if (affectedTests.size > 0) nextSteps.push('Run the directly affected tests first.');
  if (highHistoryRiskFiles > 0) nextSteps.push('Inspect high-history-risk files carefully; they changed often or recently.');
  if (entries.some((entry) => !entry.classification?.isMainline)) nextSteps.push('Verify whether non-mainline changes should be excluded from the audit.');
  if (nextSteps.length === 0) nextSteps.push('No changed files with structural impact were detected.');

  return {
    severity,
    counts: {
      changedFiles: entries.length,
      mainlineChangedFiles: mainlineChanged.length,
      affectedTests: affectedTests.size,
      maxImpact,
      highHistoryRiskFiles,
      maxHistoryRiskScore,
    },
    nextSteps,
  };
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
      return [
        `workspaceRoot: ${result.workspaceRoot}`,
        `severity: ${result.summary.severity}`,
        `changedFiles: ${result.summary.counts.changedFiles}`,
        `mainlineChangedFiles: ${result.summary.counts.mainlineChangedFiles}`,
        `affectedTests: ${result.summary.counts.affectedTests}`,
        `maxImpact: ${result.summary.counts.maxImpact}`,
        `highHistoryRiskFiles: ${result.summary.counts.highHistoryRiskFiles}`,
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

      const entries = [];
      for (const relativeFile of changed.changedFiles) {
        const resolvedPath = validateWorkspacePath(relativeFile, container.workspaceRoot);
        const classification = container.projectContext?.classifyFile(resolvedPath) || null;
        const graphKnown = Boolean(resolvedPath && container.depGraph.graph.has(resolvedPath));
        const impact = graphKnown ? container.depGraph.getImpactRadius(resolvedPath) : [];
        const affectedTests = graphKnown ? container.depGraph.findAffectedTests(resolvedPath, Number.isFinite(parsed.maxDepth) ? parsed.maxDepth : undefined) : [];
        const history = resolvedPath ? await getFileHistoryRisk(container.workspaceRoot, resolvedPath, { limit: 25 }) : { ok: false };

        entries.push({
          file: relativeFile,
          resolvedPath,
          classification,
          graphKnown,
          impactCount: impact.length,
          impact,
          affectedTestCount: affectedTests.length,
          affectedTests,
          historyRisk: history.ok ? history.historyRisk : null,
          recentCommits: history.ok ? history.recentCommits : [],
        });
      }

      return {
        ok: true,
        workspaceRoot: container.workspaceRoot,
        scope: container.depGraph.getScopeSummary(),
        summary: buildAuditDiffSummary(entries),
        changedFiles: entries,
      };
    }
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
