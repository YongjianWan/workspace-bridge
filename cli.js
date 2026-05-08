#!/usr/bin/env node
/**
 * workspace-bridge CLI
 *
 * Keeps the existing analysis engine behind a local CLI so agents
 * can call it directly.
 */
const fs = require('fs');
const path = require('path');
const { version } = require('./package.json');

const LARGE_JSON_THRESHOLD = 1024 * 1024;
const JSON_WRITE_CHUNK_SIZE = 64 * 1024;

/**
 * Write large JSON strings to stdout in chunks to avoid blocking
 * the event loop on huge strings (e.g. audit-map with 10k+ edges).
 * @param {string} json
 */
async function writeLargeJson(json) {
  if (json.length <= JSON_WRITE_CHUNK_SIZE) {
    process.stdout.write(json + '\n');
    return;
  }
  for (let i = 0; i < json.length; i += JSON_WRITE_CHUNK_SIZE) {
    const chunk = json.slice(i, i + JSON_WRITE_CHUNK_SIZE);
    process.stdout.write(chunk);
    if (i + JSON_WRITE_CHUNK_SIZE < json.length) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
  process.stdout.write('\n');
}
const { ServiceContainer } = require('./src/services/container');
const { workspaceInfo, runDiagnostics } = require('./src/tools/workspace-tools');
const { projectHealth } = require('./src/tools/health-tools');
const { dependencyGraph } = require('./src/tools/dep-tools');
const { auditSecurity } = require('./src/tools/security-tools');
const { getChangedFiles, getDiffNumstat } = require('./src/tools/git-tools');
const { getChangedLineRanges } = require('./src/tools/git-tools');
const { resolveWorkspaceFilePath } = require('./src/utils/path');
const { getFileHistoryRisk } = require('./src/tools/git-tools');
const {
  buildCompositeRisk,
  buildRepoSummary,
  buildFileSummary,
  buildAuditDiffSummary,
  buildValidationAdvice,
  buildFileValidationAdvice,
  buildProjectMap,
  buildImpactExplanations,
  countTreeFiles,
  compactChangedFile,
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

const COMMAND_GUIDES = {
  'workspace-info': {
    desc: 'Detect workspace type and root',
    when: 'First step when exploring an unknown repo. Confirm root, stack, and package manager before deeper analysis.',
    after: 'audit-summary or audit-overview for the full picture.',
  },
  diagnostics: {
    desc: 'Run quick/full diagnostics (eslint, tsc, pyright, etc.)',
    when: 'Before committing, or when CI is failing and you want local repro.',
    after: 'audit-file --file <path> if errors are localized to one file.',
  },
  'audit-summary': {
    desc: 'Aggregate health + dead-exports + unresolved + cycles',
    when: 'First look at a repo. Gives the "health snapshot" in one command.',
    after: 'audit-overview for structural skeleton, or audit-map for full graph.',
  },
  'audit-file': {
    desc: 'Aggregate impact + affected tests for one file',
    when: 'Before/after editing a single file. Know what breaks before you save.',
    after: 'impact --file <path> for deeper transitive analysis, or affected-tests for test mapping.',
  },
  'audit-diff': {
    desc: 'Aggregate changed files + impact + affected tests + history risk',
    when: 'Reviewing a PR or preparing a commit. Understand the blast radius of current worktree changes.',
    after: 'audit-file --file <path> for any high-risk file that needs individual attention.',
  },
  'audit-overview': {
    desc: 'Project panoramic view (hotspots, stability, orphans, core modules)',
    when: 'Taking over a repo for the first time. Identify where the fire is before touching code.',
    after: 'audit-map --compact for a navigable tree, or repl for precise queries.',
  },
  'audit-map': {
    desc: 'Global project map (tree + edges + issue overlay)',
    when: 'Need the full graph. Use --compact on large repos (>500 files) to avoid output explosion.',
    after: 'impact --file <path> or repl for targeted exploration of specific files.',
  },
  health: {
    desc: 'Summarize project health (CI, tests, config, deps)',
    when: 'Quick gut-check on repo hygiene. Faster than audit-summary when you only care about health.',
    after: 'audit-security if health flags missing security checks.',
  },
  'audit-security': {
    desc: 'Run external security scanners (Semgrep)',
    when: 'Security review, before releases, or when health flags missing security tools.',
    after: 'audit-diff to see if recent changes touched code near security findings.',
  },
  repl: {
    desc: 'Start interactive REPL shell',
    when: 'Large projects where CLI startup is too slow. Dep-graph stays hot in memory; queries <100ms.',
    after: 'Any atomic command (impact, dependencies, dead-exports) inside the REPL.',
  },
  watch: {
    desc: 'Watch files and print impact on save',
    when: 'Active development. Save a file → immediately see affected dependents.',
    after: 'affected-tests --file <path> if you need the full test mapping after seeing impact.',
  },
  stats: {
    desc: 'Show dependency graph statistics',
    when: 'Need raw numbers (files, edges, cycles) without the full audit-map payload.',
    after: 'audit-map --compact if the numbers look suspicious and you need visual confirmation.',
  },
  dependencies: {
    desc: 'List direct dependencies of a file',
    when: 'Debugging "why is this file here?" or tracing imports inward.',
    after: 'dependents --file <path> for the reverse direction (who imports me).',
  },
  dependents: {
    desc: 'List direct dependents of a file',
    when: 'Before deleting or renaming a file. Know who imports you.',
    after: 'impact --file <path> for transitive dependents (not just direct).',
  },
  'dead-exports': {
    desc: 'Find dead export candidates',
    when: 'Cleanup phase. Remove unused code to reduce maintenance surface.',
    after: 'audit-file --file <path> on any dead-export candidate to confirm it is truly unused.',
  },
  unresolved: {
    desc: 'Find unresolved imports',
    when: 'Build is broken, or after moving/renaming files. Fix broken paths.',
    after: 'audit-diff to verify the fix did not introduce new unresolved imports.',
  },
  cycles: {
    desc: 'Find circular dependencies',
    when: 'Architecture review, or before refactoring layered code.',
    after: 'audit-file --file <path> on any file in the cycle to plan the break point.',
  },
  impact: {
    desc: 'Find impact radius for a file',
    when: 'Before risky changes. See the full transitive blast radius (not just direct dependents).',
    after: 'affected-tests --file <path> to map the impacted area to specific tests.',
  },
  'affected-tests': {
    desc: 'Find tests related to a file',
    when: 'Before/after changes. Know which tests to run or update.',
    after: 'impact --file <path> if test mapping is empty (heuristic may miss cross-stack tests).',
  },
};

function printCommandHelp(command) {
  const guide = COMMAND_GUIDES[command];
  if (!guide) {
    console.log(`No detailed help for '${command}'. Run without arguments for full command list.`);
    return;
  }
  console.log(`workspace-bridge ${command}

  ${guide.desc}

WHEN TO USE:
  ${guide.when}

AFTER THIS:
  ${guide.after}

Common Options:
  --cwd <path>    Target workspace or file path
  --json          Print machine-readable JSON
  --quiet         Suppress stderr logs during CLI execution
  --help          Show help (or --help <command> for detailed guide)
`);
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
  init                    Create default .workspace-bridge.json in cwd
  audit-security          Run external security scanners (Semgrep)
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
                          Find tests related to a file

Options:
  --cwd <path>            Target workspace or file path
  --exclude <paths>       Comma-separated directories or path fragments to exclude
  --mode <quick|full>     Diagnostics mode (default: quick)
  --file <path>           File path for file-scoped commands
  --max-depth <n>         Max depth for affected-tests (default: 5)
  --reuse-hints <mode>    Reuse hints mode for audit-diff: on|off (default: off)
  --hotspot-data <path>   Write audit-overview hotspot visualization JSON
  --stability-trend-data <path>  Write audit-overview stability trend JSON
  --trend-granularity <mode>  Trend bucket mode for stability trend: day|week (default: day)
  --overview-dashboard <path>  Write audit-overview single-file HTML dashboard
  --json                  Print machine-readable JSON
  --quiet                 Suppress stderr logs during CLI execution
  --compact              Emit condensed tree and directory-level edges
  --config <name>        Semgrep config (default: auto)
  --language <lang>      Filter security scan to one language
  --help                  Show help
  --help <command>       Show detailed guide for a command
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
    '--json': true,
    '--quiet': true,
    '--compact': true,
    '--version': true,
    '-v': true,
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

  if (Number.isFinite(raw.maxDepth) && raw.maxDepth <= 0) {
    throw new Error(`Invalid --max-depth value: ${raw.maxDepth}. Expected a positive integer`);
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
    targets: raw._.slice(1),
    json: Boolean(raw['--json']),
    quiet: Boolean(raw['--quiet']),
    compact: Boolean(raw['--compact']),
    version: Boolean(raw['--version']) || Boolean(raw['-v']),
    help: Boolean(raw['--help']) || Boolean(raw['-h']),
  };
}

function requireFile(parsed, command) {
  if (!parsed.file) {
    throw new Error(`${command} requires --file <path>`);
  }
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
    case 'audit-summary': {
      const lines = [
        `workspaceRoot: ${result.workspaceRoot}`,
        `severity: ${result.summary.severity}`,
        `healthScore: ${result.health.healthScore}`,
        `mainlineFiles: ${result.scope.counts.mainlineFiles}`,
        `nonMainlineFiles: ${result.scope.counts.nonMainlineFiles}`,
        `deadExportCount: ${result.deadExports.deadExportCount}`,
        `unresolvedCount: ${result.unresolved.unresolvedCount}`,
        `cycleCount: ${result.cycles.cycleCount}`,
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
        `totalFiles: ${result.skeleton?.totalFiles ?? 0}`,
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
        `dependencyCount: ${result.dependencyCount}`,
        ...result.dependencies.map((d) => `  → ${d}`),
      ].join('\n');
    case 'dependents':
      return [
        `file: ${result.file}`,
        `dependentCount: ${result.dependentCount}`,
        ...result.dependents.map((d) => `  ← ${d}`),
      ].join('\n');
    case 'dead-exports': {
      const lines = [
        `deadExportCount: ${result.deadExportCount}`,
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
        `cycleCount: ${result.cycleCount}`,
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
        `affectedTestCount: ${result.affectedTestCount}`,
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
      const resolvedPath = resolveWorkspaceFilePath(parsed.file, container.workspaceRoot);
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
      const frameworkPattern = container.depGraph.getFrameworkHint(resolvedPath);
      const validationAdvice = buildFileValidationAdvice(resolvedPath, container.workspaceRoot);
      return {
        ok: impact.ok !== false && affectedTests.ok !== false,
        workspaceRoot: container.workspaceRoot,
        file: parsed.file,
        resolvedPath: impact.resolvedPath || affectedTests.resolvedPath || null,
        summary: buildFileSummary(impact, affectedTests),
        frameworkPattern,
        validationAdvice,
        impact,
        affectedTests,
      };
    }
    case 'audit-diff': {
      const changed = await getChangedFiles(container.workspaceRoot, { staged: false, includeUntracked: true });
      if (changed.ok === false) {
        return changed;
      }

      const numstat = await getDiffNumstat(container.workspaceRoot, { staged: false, includeUntracked: true });
      const changeMetrics = numstat.ok ? {
        totalAdditions: numstat.totalAdditions,
        totalDeletions: numstat.totalDeletions,
        changedFileCount: numstat.files.length,
      } : null;

      const entries = await mapWithConcurrency(changed.changedFiles, DEFAULTS.CLI_CONCURRENCY, async (relativeFile) => {
        const resolvedPath = resolveWorkspaceFilePath(relativeFile, container.workspaceRoot);
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
              minScore: DEFAULTS.REUSE_HINTS_MIN_SCORE,
              maxPerFunction: DEFAULTS.REUSE_HINTS_MAX_PER_FUNCTION,
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
        const frameworkPattern = container.depGraph.getFrameworkHint(resolvedPath);
        const baseEntry = {
          file: relativeFile,
          resolvedPath,
          classification,
          graphKnown,
          frameworkPattern,
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
          frameworkPattern: null,
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

      const shouldAutoCompact = !parsed.compact && safeEntries.length > DEFAULTS.AUDIT_DIFF_AUTO_COMPACT_THRESHOLD;
      const finalEntries = (parsed.compact || shouldAutoCompact)
        ? safeEntries.map((entry) => compactChangedFile(entry))
        : safeEntries;

      return {
        ok: true,
        workspaceRoot: container.workspaceRoot,
        scope: container.depGraph.getScopeSummary(),
        summary: buildAuditDiffSummary(finalEntries, changeMetrics),
        validationAdvice: buildValidationAdvice(finalEntries, container.workspaceRoot),
        options: {
          reuseHints: parsed.reuseHints,
        },
        changedFiles: finalEntries,
      };
    }
    case 'audit-overview':
      return buildProjectOverview(parsed, container);
    case 'audit-map': {
      await container.ensureReady();
      return buildProjectMap(container.depGraph, { compact: parsed.compact });
    }
    case 'health':
      return projectHealth({ cwd: parsed.cwd }, container);
    case 'audit-security':
      return auditSecurity({ cwd: parsed.cwd, targets: parsed.targets, config: parsed.config, language: parsed.language }, container);
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
    case 'repl': {
      const { startRepl } = require('./src/cli/repl');
      await startRepl({ cwd: parsed.cwd, exclude: parsed.exclude, quiet: parsed.quiet });
      return { ok: true, __managedLifecycle: true };
    }
    case 'watch': {
      const { startWatch } = require('./src/cli/watch');
      await startWatch({ cwd: parsed.cwd, exclude: parsed.exclude, compact: parsed.compact });
      return { ok: true, __managedLifecycle: true };
    }
    case 'init': {
      const configPath = path.join(parsed.cwd || process.cwd(), '.workspace-bridge.json');
      if (fs.existsSync(configPath)) {
        const err = { ok: false, error: `.workspace-bridge.json already exists at ${configPath}` };
        if (parsed.json) console.log(JSON.stringify(err, null, 2));
        else console.error(err.error);
        return { ok: false, __managedLifecycle: true };
      }
      const root = parsed.cwd || process.cwd();
      const GENERATED_HINTS = new Set(['node_modules', 'dist', 'build', '.next', '.nuxt', '.svelte-kit', 'out', '.turbo', 'coverage', '.cache', '.git']);
      const REFERENCE_HINTS = new Set(['docs', 'test', 'tests', 'benchmark', 'scripts', 'reference', 'fixtures', 'fixture-temp']);
      const generated = [];
      const reference = [];
      try {
        for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          if (GENERATED_HINTS.has(entry.name)) generated.push(entry.name);
          else if (REFERENCE_HINTS.has(entry.name)) reference.push(entry.name);
        }
      } catch { /* ignore read errors */ }
      const defaultConfig = {
        $schema: 'https://workspace-bridge.dev/schema/v1.json',
        directories: {
          active: [],
          reference,
          archive: [],
          generated,
        },
      };
      fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2) + '\n');
      const result = {
        ok: true,
        configPath,
        message: `Created .workspace-bridge.json. ${generated.length > 0 ? `Detected generated directories: ${generated.join(', ')}. ` : ''}${reference.length > 0 ? `Detected reference directories: ${reference.join(', ')}. ` : ''}Adjust "active" / "archive" as needed.`,
      };
      if (parsed.json) console.log(JSON.stringify(result, null, 2));
      else console.log(result.message);
      return { ok: true, __managedLifecycle: true };
    }
    default:
      throw new Error(`Unknown command: ${parsed.command}. Run "workspace-bridge-cli --help" for available commands.`);
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

  if (parsed.version) {
    console.log(`workspace-bridge ${version}`);
    return;
  }

  if (parsed.help) {
    if (parsed.command && COMMAND_GUIDES[parsed.command]) {
      printCommandHelp(parsed.command);
    } else {
      printUsage();
    }
    return;
  }
  if (!parsed.command) {
    printUsage();
    return;
  }

  const SELF_MANAGED_COMMANDS = new Set(['repl', 'watch', 'init']);
  if (SELF_MANAGED_COMMANDS.has(parsed.command)) {
    await runCommand(parsed, null);
    return;
  }

  const container = new ServiceContainer({ quiet: parsed.quiet });

  try {
    const initialized = await container.initialize(parsed.cwd, TIMEOUTS.INIT_TIMEOUT_MS, {
      watch: false,
      excludeDirs: parsed.exclude,
    });
    if (!initialized) {
      throw container.initError || new Error('Failed to initialize workspace container');
    }

    const result = await runCommand(parsed, container);
    if (result && typeof result === 'object' && result.ok !== false && container) {
      result.staleness = container.getStaleness();
    }
    if (parsed.json) {
      const jsonStr = JSON.stringify(result, null, 2);
      if (jsonStr.length > LARGE_JSON_THRESHOLD && !parsed.quiet) {
        const edges = result && result.edges ? result.edges.length : 0;
        if (edges > 5000 && !parsed.compact) {
          process.stderr.write(
            '[warn] JSON output is very large (~' +
              Math.round(jsonStr.length / 1024 / 1024) +
              'MB). Consider using --compact for large projects.\n'
          );
        }
      }
      await writeLargeJson(jsonStr);
    } else {
      console.log(formatHuman(parsed.command, result));
    }

    if (result && result.ok === false) {
      process.exitCode = 1;
    }
  } catch (err) {
    if (container && container.initError && err === container.initError && err.stack) {
      console.error(err.stack);
    } else {
      console.error(err.message || String(err));
    }
    process.exitCode = 1;
  } finally {
    await container.shutdown();
  }
}

main();

