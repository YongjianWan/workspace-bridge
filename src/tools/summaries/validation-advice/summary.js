/**
 * Summary builder: high-level validation recommendations from metrics.
 */
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

module.exports = { buildSummary };
