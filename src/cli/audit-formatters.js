const { detectStack, generateCommands } = require('../utils/stack-detector');

function toNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function buildCompositeRisk(entry) {
  const reasons = [];
  let score = 0;

  const impactCount = toNumber(entry?.impactCount);
  const affectedTestCount = toNumber(entry?.affectedTestCount);
  const historyRiskScore = toNumber(entry?.historyRisk?.score);
  const symbolMode = entry?.symbolImpact?.mode || null;

  if (impactCount >= 10) {
    score += 4;
    reasons.push(`Large impact radius (${impactCount} dependents).`);
  } else if (impactCount >= 5) {
    score += 3;
    reasons.push(`Broad impact radius (${impactCount} dependents).`);
  } else if (impactCount >= 2) {
    score += 1;
    reasons.push(`Has transitive impact (${impactCount} dependents).`);
  }

  if (affectedTestCount >= 3) {
    score += 2;
    reasons.push(`Many mapped tests affected (${affectedTestCount}).`);
  } else if (affectedTestCount >= 1) {
    score += 1;
    reasons.push(`Mapped tests affected (${affectedTestCount}).`);
  } else if (impactCount >= 3) {
    score += 1;
    reasons.push('No mapped tests despite structural impact.');
  }

  if (historyRiskScore >= 6) {
    score += 2;
    reasons.push(`History risk is high (${historyRiskScore}).`);
  } else if (historyRiskScore >= 3) {
    score += 1;
    reasons.push(`History risk is medium (${historyRiskScore}).`);
  }

  if (symbolMode === 'file-fallback') {
    score += 1;
    reasons.push('Symbol analysis fell back to file-level impact.');
  }

  if (entry?.classification?.isMainline === false && score > 0) {
    score -= 1;
    reasons.push('Non-mainline file: downgrade one point.');
  }

  let level = 'low';
  if (score >= 6) level = 'high';
  else if (score >= 3) level = 'medium';

  if (reasons.length === 0) {
    reasons.push('Low observed structural and historical risk.');
  }

  return {
    level,
    score,
    reasons,
  };
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
  let highCompositeRiskFiles = 0;
  let maxCompositeRiskScore = 0;

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
    const compositeScore = toNumber(entry.compositeRisk?.score);
    maxCompositeRiskScore = Math.max(maxCompositeRiskScore, compositeScore);
    if (entry.compositeRisk?.level === 'high') {
      highCompositeRiskFiles += 1;
    }
    for (const testFile of entry.affectedTests || []) {
      affectedTests.add(testFile.file);
    }
  }

  let severity = 'low';
  if (highRiskFiles > 0 || affectedTests.size >= 5 || highHistoryRiskFiles > 0 || highCompositeRiskFiles > 0) {
    severity = 'high';
  } else if (mainlineChanged.length > 0 && (affectedTests.size > 0 || maxImpact > 0 || maxHistoryRiskScore >= 3 || maxCompositeRiskScore >= 3)) {
    severity = 'medium';
  }

  const nextSteps = [];
  if (mainlineChanged.length > 0) nextSteps.push('Review changed mainline files before merging.');
  if (affectedTests.size > 0) nextSteps.push('Run the directly affected tests first.');
  if (highHistoryRiskFiles > 0) nextSteps.push('Inspect high-history-risk files carefully; they changed often or recently.');
  if (highCompositeRiskFiles > 0) nextSteps.push('Prioritize high composite-risk files before broad validation.');
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
      highCompositeRiskFiles,
      maxCompositeRiskScore,
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

    if (['md', 'mdx', 'mdtxt', 'markdown', 'txt', 'rst'].includes(ext) ||
        file.toLowerCase().includes('readme') ||
        file.toLowerCase().includes('changelog') ||
        file.toLowerCase().includes('contributing')) {
      types.add('docs');
    } else if (['json', 'yaml', 'yml', 'toml', 'ini', 'conf', 'config'].includes(ext) ||
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
    } else if (fileRole === 'test' ||
             file.includes('.test.') ||
             file.includes('.spec.') ||
             file.includes('/test/') ||
             file.includes('/tests/')) {
      types.add('tests');
    } else if (fileRole === 'script' ||
             file.includes('/scripts/') ||
             file.includes('/bin/') ||
             ext === 'sh' ||
             ext === 'bash' ||
             ext === 'ps1') {
      types.add('scripts');
    } else {
      types.add('code');
    }
  }

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
  const turbulenceFiles = [];
  const highImpactFiles = [];
  const highCompositeFiles = [];
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
    const isHighComposite = entry.compositeRisk?.level === 'high';

    if (isHighComposite) {
      highCompositeFiles.push({
        file: entry.file,
        reason: entry.compositeRisk.reasons?.[0] || `Composite risk score ${entry.compositeRisk.score}`,
      });
    }

    if (isHighHistoryRisk && !isHighImpact) {
      turbulenceFiles.push({
        file: entry.file,
        reason: `Changed often (${entry.historyRisk?.authorCount} authors, ${entry.historyRisk?.commitCount} commits) but narrow impact (${entry.impactCount} dependents)`,
      });
    } else if (isHighImpact) {
      highImpactFiles.push(entry.file);
    }

    if (!entry.classification?.isMainline) {
      nonMainlineFiles.push(entry.file);
    }
  }

  const phases = [];
  const smokeTargets = Array.from(new Set(smokeFiles)).sort();
  phases.push({
    phase: 'smoke',
    priority: 'high',
    reason: template.smoke.reason,
    actions: template.smoke.actions,
    targets: smokeTargets,
  });

  const focusedSteps = [];
  const uniqueHighImpact = Array.from(new Set(highImpactFiles)).sort();
  const uniqueHighComposite = Array.from(new Set(highCompositeFiles.map((item) => item.file))).sort();
  const uniqueTurbulence = Array.from(new Set(turbulenceFiles.map(t => t.file))).sort();
  const uniqueDirectTests = Array.from(directTests).sort();
  const uniqueNonMainline = Array.from(new Set(nonMainlineFiles)).sort();

  if (uniqueHighComposite.length > 0) {
    focusedSteps.push({
      step: 1,
      name: 'review-high-composite-risk',
      reason: 'These files combine structural and history risk; review first.',
      targets: uniqueHighComposite,
      notes: highCompositeFiles.map((item) => ({ file: item.file, note: item.reason })),
    });
  }

  if (uniqueHighImpact.length > 0) {
    focusedSteps.push({
      step: focusedSteps.length + 1,
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
  if (highCompositeFiles.length > 0) {
    summary.push({
      priority: 'high',
      kind: 'risk',
      message: 'Review high composite-risk files first.',
      targets: uniqueHighComposite,
      notes: highCompositeFiles.map((item) => ({ file: item.file, reason: item.reason })),
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

  const stack = detectStack(workspaceRoot);
  const commands = generateCommands(stack, changeType, smokeTargets, focusedSteps);

  return {
    changeType,
    stack: {
      profile: stack.profile,
      packageManager: stack.packageManager,
      node: stack.node,
      python: stack.python,
    },
    commands,
    phases,
    summary,
  };
}

module.exports = {
  toNumber,
  buildCompositeRisk,
  buildRepoSummary,
  buildFileSummary,
  buildAuditDiffSummary,
  buildValidationAdvice,
};
