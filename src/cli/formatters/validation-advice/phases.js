/**
 * Phase orchestration: smoke → focused → full validation plan builder.
 */
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

module.exports = { buildFocusedSteps, buildPhases };
