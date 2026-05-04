const { detectStack, generateCommands } = require('../../utils/stack-detector');
const { classifyChangeType, getValidationTemplate } = require('./audit-diff-summary');

function collectEntryMetrics(entries) {
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

  return {
    directTests,
    indirectTests,
    turbulenceFiles,
    highImpactFiles,
    highCompositeFiles,
    smokeFiles,
    graphTouchedFiles,
    nonMainlineFiles,
  };
}

function buildFocusedSteps(metrics) {
  const focusedSteps = [];
  const uniqueHighComposite = Array.from(new Set(metrics.highCompositeFiles.map((item) => item.file))).sort();
  const uniqueHighImpact = Array.from(new Set(metrics.highImpactFiles)).sort();
  const uniqueTurbulence = Array.from(new Set(metrics.turbulenceFiles.map((t) => t.file))).sort();
  const uniqueDirectTests = Array.from(metrics.directTests).sort();
  const uniqueNonMainline = Array.from(new Set(metrics.nonMainlineFiles)).sort();

  if (uniqueHighComposite.length > 0) {
    focusedSteps.push({
      step: 1,
      name: 'review-high-composite-risk',
      reason: 'These files combine structural and history risk; review first.',
      targets: uniqueHighComposite,
      notes: metrics.highCompositeFiles.map((item) => ({ file: item.file, note: item.reason })),
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
      notes: metrics.turbulenceFiles.map((t) => ({ file: t.file, note: t.reason })),
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

  return { focusedSteps, uniqueHighImpact, uniqueTurbulence, uniqueDirectTests, uniqueNonMainline };
}

function buildPhases(metrics, template) {
  const phases = [];
  const smokeTargets = Array.from(new Set(metrics.smokeFiles)).sort();
  phases.push({
    phase: 'smoke',
    priority: 'high',
    reason: template.smoke.reason,
    actions: template.smoke.actions,
    targets: smokeTargets,
  });

  const { focusedSteps, uniqueHighImpact, uniqueTurbulence, uniqueDirectTests, uniqueNonMainline } = buildFocusedSteps(metrics);

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
    ...Array.from(metrics.indirectTests),
    ...metrics.graphTouchedFiles,
  ])).sort();

  phases.push({
    phase: 'full',
    priority: focusedSteps.length > 0 ? 'medium' : 'low',
    reason: template.full.reason,
    actions: template.full.actions,
    targets: fullTargets,
  });

  return { phases, smokeTargets, focusedSteps };
}

function buildSummary(metrics) {
  const summary = [];
  if (metrics.directTests.size > 0) {
    summary.push({
      priority: 'high',
      kind: 'tests',
      message: 'Run directly affected tests first.',
      targets: Array.from(metrics.directTests).sort(),
    });
  }
  if (metrics.highImpactFiles.length > 0) {
    summary.push({
      priority: 'high',
      kind: 'review',
      message: 'Review high-impact files carefully before merge.',
      targets: Array.from(new Set(metrics.highImpactFiles)).sort(),
    });
  }
  if (metrics.highCompositeFiles.length > 0) {
    const uniqueHighComposite = Array.from(new Set(metrics.highCompositeFiles.map((item) => item.file))).sort();
    summary.push({
      priority: 'high',
      kind: 'risk',
      message: 'Review high composite-risk files first.',
      targets: uniqueHighComposite,
      notes: metrics.highCompositeFiles.map((item) => ({ file: item.file, reason: item.reason })),
    });
  }
  if (metrics.turbulenceFiles.length > 0) {
    summary.push({
      priority: 'medium',
      kind: 'review',
      message: 'Review turbulence files - they change often but have narrow impact.',
      targets: metrics.turbulenceFiles.map((t) => t.file),
      notes: metrics.turbulenceFiles.map((t) => ({ file: t.file, reason: t.reason })),
    });
  }
  if (metrics.indirectTests.size > 0) {
    summary.push({
      priority: 'medium',
      kind: 'tests',
      message: 'Then run indirectly affected tests.',
      targets: Array.from(metrics.indirectTests).sort(),
    });
  }
  if (summary.length === 0) {
    summary.push({
      priority: 'low',
      kind: 'review',
      message: 'Start with a smoke check; no narrower validation targets were detected.',
      targets: Array.from(new Set(metrics.smokeFiles)).sort(),
    });
  }
  return summary;
}

function pickSuggestedCommand(allCommands) {
  const names = ['focused-tests', 'all-tests', 'type-check', 'lint'];
  for (const key of names) {
    const hit = allCommands.find((cmd) => String(cmd.name || '').includes(key));
    if (hit?.cmd) return hit.cmd;
  }
  return allCommands[0]?.cmd || null;
}

function buildTopRiskActions(entries, allCommands) {
  return entries
    .filter((entry) => entry?.compositeRisk)
    .sort((a, b) => (b.compositeRisk.score || 0) - (a.compositeRisk.score || 0))
    .slice(0, 3)
    .map((entry) => {
      const actions = [];
      if (entry.affectedTestCount > 0) {
        actions.push(`Run mapped tests first (${entry.affectedTestCount}).`);
      } else if (entry.impactCount > 0) {
        actions.push(`No mapped tests; inspect dependents (${entry.impactCount}) and add focused checks.`);
      } else {
        actions.push('No structural impact detected; run smoke checks and review recent history.');
      }
      if (entry.historyRisk?.level === 'high') {
        actions.push('Read last 3 commits for context before editing.');
      }
      if (entry.symbolImpact?.mode === 'file-fallback') {
        actions.push('Symbol analysis fell back to file-level; manually verify exported symbol usage.');
      }
      return {
        file: entry.file,
        score: entry.compositeRisk.score,
        level: entry.compositeRisk.level,
        suggestedCommand: pickSuggestedCommand(allCommands),
        actions,
        evidence: {
          impactCount: entry.impactCount || 0,
          affectedTestCount: entry.affectedTestCount || 0,
          historyRiskLevel: entry.historyRisk?.level || 'low',
          historySignals: (entry.historyRisk?.signals || []).slice(0, 2),
          symbolMode: entry.symbolImpact?.mode || 'unknown',
          topImpactedSymbols: (entry.symbolImpact?.symbolToDependents || [])
            .slice(0, 3)
            .map((item) => ({ symbol: item.symbol, dependentCount: item.dependentCount })),
        },
      };
    });
}

function buildValidationAdvice(entries, workspaceRoot) {
  const changeType = classifyChangeType(entries);
  const template = getValidationTemplate(changeType);

  const metrics = collectEntryMetrics(entries);
  const { phases, smokeTargets, focusedSteps } = buildPhases(metrics, template);
  const summary = buildSummary(metrics);

  const stack = detectStack(workspaceRoot);
  const commands = generateCommands(stack, changeType, smokeTargets, focusedSteps);

  const allCommands = [
    ...(commands.focused || []),
    ...(commands.smoke || []),
    ...(commands.full || []),
  ];

  const topRiskActions = buildTopRiskActions(entries, allCommands);

  return {
    changeType,
    stack: {
      profile: stack.profile,
      packageManager: stack.packageManager,
      node: stack.node,
      python: stack.python,
      java: stack.java,
      go: stack.go,
      rust: stack.rust,
    },
    commands,
    topRiskActions,
    phases,
    summary,
  };
}

module.exports = { buildValidationAdvice };
