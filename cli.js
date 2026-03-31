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
const { detectStack, generateCommands } = require('./src/utils/stack-detector');
const { buildProjectOverview } = require('./src/tools/overview-tools');

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

function classifyChangeType(entries) {
  const types = new Set();
  for (const entry of entries) {
    const file = entry.file || '';
    const ext = file.split('.').pop()?.toLowerCase();
    const fileRole = entry.classification?.fileRole;

    // 文档类型
    if (['md', 'mdx', 'mdtxt', 'markdown', 'txt', 'rst'].includes(ext) ||
        file.toLowerCase().includes('readme') ||
        file.toLowerCase().includes('changelog') ||
        file.toLowerCase().includes('contributing')) {
      types.add('docs');
    }
    // 配置类型
    else if (['json', 'yaml', 'yml', 'toml', 'ini', 'conf', 'config'].includes(ext) ||
             fileRole === 'config' ||
             file.includes('.env') ||
             file.includes('tsconfig') ||
             file.includes('vite.config') ||
             file.includes('eslint') ||
             file.includes('prettier') ||
             file.includes('jest.config') ||
             file.includes('pyproject') ||
             file.includes('requirements')) {
      types.add('config');
    }
    // 测试类型
    else if (fileRole === 'test' ||
             file.includes('.test.') ||
             file.includes('.spec.') ||
             file.includes('/test/') ||
             file.includes('/tests/')) {
      types.add('tests');
    }
    // 脚本类型
    else if (fileRole === 'script' ||
             file.includes('/scripts/') ||
             file.includes('/bin/') ||
             ext === 'sh' ||
             ext === 'bash' ||
             ext === 'ps1') {
      types.add('scripts');
    }
    // 代码类型 (默认)
    else {
      types.add('code');
    }
  }

  // 返回主要类型，优先级: code > tests > config > scripts > docs
  if (types.has('code')) return 'code';
  if (types.has('tests')) return 'tests';
  if (types.has('config')) return 'config';
  if (types.has('scripts')) return 'scripts';
  if (types.has('docs')) return 'docs';
  return 'code';
}

function getValidationTemplate(changeType) {
  const templates = {
    docs: {
      smoke: {
        reason: 'Documentation changes: verify formatting and obvious errors first.',
        actions: [
          'Preview rendered markdown for formatting issues.',
          'Check for broken internal links.',
          'Verify code examples in docs still match current API.',
        ],
      },
      focused: {
        reason: 'Review content accuracy and completeness.',
        actions: [
          'Review changed sections for technical accuracy.',
          'Check if related docs need同步更新.',
        ],
      },
      full: {
        reason: 'Final polish before merge.',
        actions: [
          'Run docs linting if available (markdownlint, etc.).',
          'Verify external links are not broken.',
        ],
      },
    },
    config: {
      smoke: {
        reason: 'Config changes: validate syntax and basic structure first.',
        actions: [
          'Validate JSON/YAML syntax.',
          'Check config schema if available.',
          'Verify required fields are present.',
        ],
      },
      focused: {
        reason: 'Test config consumption points.',
        actions: [
          'Run affected unit tests that read this config.',
          'Start the app/service to verify config loads correctly.',
          'Check for environment-specific values that might break.',
        ],
      },
      full: {
        reason: 'Full integration verification.',
        actions: [
          'Run full test suite to catch subtle config side effects.',
          'Verify in staging environment if applicable.',
        ],
      },
    },
    tests: {
      smoke: {
        reason: 'Test changes: verify tests run and pass first.',
        actions: [
          'Run the modified tests to ensure they pass.',
          'Check for syntax errors in new test code.',
        ],
      },
      focused: {
        reason: 'Validate test quality and coverage.',
        actions: [
          'Review test assertions for correctness.',
          'Check that tests actually test what they claim.',
          'Verify test setup/teardown is proper.',
        ],
      },
      full: {
        reason: 'Ensure no regressions in related areas.',
        actions: [
          'Run full test suite to catch side effects.',
          'Check test runtime - no significant slowdowns.',
        ],
      },
    },
    scripts: {
      smoke: {
        reason: 'Script changes: check syntax and basic execution.',
        actions: [
          'Run script with --help or dry-run if supported.',
          'Check for syntax errors (shellcheck for bash, etc.).',
          'Verify script is executable (chmod +x).',
        ],
      },
      focused: {
        reason: 'Test script in isolated context.',
        actions: [
          'Run script against test data or staging environment.',
          'Verify error handling works correctly.',
          'Check script output format.',
        ],
      },
      full: {
        reason: 'Integration and edge case testing.',
        actions: [
          'Test script with various input combinations.',
          'Verify cleanup on interruption/failure.',
          'Check logging and observability.',
        ],
      },
    },
    code: {
      smoke: {
        reason: 'Always start with a cheap sanity pass over the edited surface.',
        actions: [
          'Open the changed files and sanity-check obvious regressions.',
          'Run the lightest command that proves the CLI still starts and basic commands still return JSON.',
        ],
      },
      focused: {
        reason: 'These files or tests are closest to the current change and most likely to catch breakage fast.',
        actions: [
          'Run directly affected tests first.',
          'Inspect history-risk and high-impact files carefully.',
        ],
      },
      full: {
        reason: 'Broaden validation once the cheap and focused checks are clean.',
        actions: [
          'Run indirectly affected tests next.',
          'Re-check graph-touched modules before merge.',
        ],
      },
    },
  };

  return templates[changeType] || templates.code;
}

function buildValidationAdvice(entries, workspaceRoot) {
  const changeType = classifyChangeType(entries);
  const template = getValidationTemplate(changeType);

  const directTests = new Set();
  const indirectTests = new Set();
  const riskyFiles = [];
  const turbulenceFiles = []; // 高历史风险 + 低结构影响
  const highImpactFiles = []; // 高结构影响
  const smokeFiles = [];
  const graphTouchedFiles = [];
  const nonMainlineFiles = [];

  for (const entry of entries) {
    smokeFiles.push(entry.file);
    if (entry.graphKnown) {
      graphTouchedFiles.push(entry.file);
    }

    if (entry.affectedTestCount > 0) {
      for (const test of entry.affectedTests || []) {
        if (test.distance <= 1) {
          directTests.add(test.file);
        } else {
          indirectTests.add(test.file);
        }
      }
    }

    const isHighHistoryRisk = entry.historyRisk?.level === 'high';
    const isHighImpact = entry.impactCount >= 5;

    if (isHighHistoryRisk && !isHighImpact) {
      // turbulence: 经常改动但影响面小
      turbulenceFiles.push({
        file: entry.file,
        reason: `Changed often (${entry.historyRisk?.authorCount} authors, ${entry.historyRisk?.churn} commits) but narrow impact (${entry.impactCount} dependents)`,
      });
    } else if (isHighImpact) {
      highImpactFiles.push(entry.file);
    }

    if (!entry.classification?.isMainline) {
      nonMainlineFiles.push(entry.file);
    }
  }

  const phases = [];

  // Smoke phase
  const smokeTargets = Array.from(new Set(smokeFiles)).sort();
  phases.push({
    phase: 'smoke',
    priority: 'high',
    reason: template.smoke.reason,
    actions: template.smoke.actions,
    targets: smokeTargets,
  });

  // Focused phase - 拆分成有序的 steps
  const focusedSteps = [];
  const uniqueHighImpact = Array.from(new Set(highImpactFiles)).sort();
  const uniqueTurbulence = Array.from(new Set(turbulenceFiles.map(t => t.file))).sort();
  const uniqueDirectTests = Array.from(directTests).sort();
  const uniqueNonMainline = Array.from(new Set(nonMainlineFiles)).sort();

  if (uniqueHighImpact.length > 0) {
    focusedSteps.push({
      step: 1,
      name: 'review-high-impact',
      reason: 'High-impact files affect many dependents; review carefully first.',
      targets: uniqueHighImpact,
    });
  }

  if (uniqueTurbulence.length > 0) {
    focusedSteps.push({
      step: focusedSteps.length + 1,
      name: 'review-turbulence',
      reason: 'These files change often but have narrow impact; check recent commits for context.',
      targets: uniqueTurbulence,
      notes: turbulenceFiles.map(t => ({ file: t.file, note: t.reason })),
    });
  }

  if (uniqueDirectTests.length > 0) {
    focusedSteps.push({
      step: focusedSteps.length + 1,
      name: 'run-direct-tests',
      reason: 'Directly affected tests catch breakage fastest.',
      targets: uniqueDirectTests,
    });
  }

  if (uniqueNonMainline.length > 0) {
    focusedSteps.push({
      step: focusedSteps.length + 1,
      name: 'verify-non-mainline',
      reason: 'Verify non-mainline changes are intentional and properly scoped.',
      targets: uniqueNonMainline,
    });
  }

  if (focusedSteps.length > 0) {
    phases.push({
      phase: 'focused',
      priority: 'high',
      reason: template.focused.reason,
      actions: template.focused.actions,
      steps: focusedSteps,
      targets: Array.from(new Set([
        ...uniqueHighImpact,
        ...uniqueTurbulence,
        ...uniqueDirectTests,
        ...uniqueNonMainline,
      ])).sort(),
    });
  }

  // Full phase
  const fullTargets = Array.from(new Set([
    ...Array.from(indirectTests),
    ...graphTouchedFiles,
  ])).sort();

  phases.push({
    phase: 'full',
    priority: focusedSteps.length > 0 ? 'medium' : 'low',
    reason: template.full.reason,
    actions: template.full.actions,
    targets: fullTargets,
  });

  // Summary - 保留原有逻辑
  const summary = [];
  if (directTests.size > 0) {
    summary.push({
      priority: 'high',
      kind: 'tests',
      message: 'Run directly affected tests first.',
      targets: Array.from(directTests).sort(),
    });
  }
  if (highImpactFiles.length > 0) {
    summary.push({
      priority: 'high',
      kind: 'review',
      message: 'Review high-impact files carefully before merge.',
      targets: Array.from(new Set(highImpactFiles)).sort(),
    });
  }
  if (turbulenceFiles.length > 0) {
    summary.push({
      priority: 'medium',
      kind: 'review',
      message: 'Review turbulence files - they change often but have narrow impact.',
      targets: turbulenceFiles.map(t => t.file),
      notes: turbulenceFiles.map(t => ({ file: t.file, reason: t.reason })),
    });
  }
  if (indirectTests.size > 0) {
    summary.push({
      priority: 'medium',
      kind: 'tests',
      message: 'Then run indirectly affected tests.',
      targets: Array.from(indirectTests).sort(),
    });
  }
  if (summary.length === 0) {
    summary.push({
      priority: 'low',
      kind: 'review',
      message: 'Start with a smoke check; no narrower validation targets were detected.',
      targets: smokeTargets,
    });
  }

  // Generate concrete commands based on tech stack
  const stack = detectStack(workspaceRoot);
  const commands = generateCommands(stack, changeType, smokeTargets, focusedSteps);

  return {
    changeType,
    stack: {
      packageManager: stack.packageManager,
      testRunner: stack.testRunner?.name || null,
      linters: stack.linters,
      typeChecker: stack.typeChecker,
    },
    commands,
    phases,
    summary,
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
        `validationPhases: ${result.validationAdvice.phases.length}`,
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
        validationAdvice: buildValidationAdvice(entries, container.workspaceRoot),
        changedFiles: entries,
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
