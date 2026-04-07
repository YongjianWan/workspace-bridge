#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { DependencyGraph } = require('../src/services/dep-graph');

function makeDepGraph() {
  const depGraph = new DependencyGraph('/repo', { fileMetadata: new Map() });
  const P = (value) => depGraph.normalizeFilePath(value);

  depGraph.graph = new Map([
    // JS barrel chain
    [P('/repo/src/core/util.ts'), { imports: [], exports: ['helper'] }],
    [P('/repo/src/core/index.ts'), { imports: [P('/repo/src/core/util.ts')], exports: ['helper'] }],
    [P('/repo/src/app.ts'), { imports: [P('/repo/src/core/index.ts')], exports: ['run'] }],
    [P('/repo/test/app.test.ts'), { imports: [P('/repo/src/app.ts')], exports: ['testRun'] }],

    // Python naming variants
    [P('/repo/pkg/module.py'), { imports: [], exports: ['run'] }],
    [P('/repo/tests/test_module.py'), { imports: [], exports: ['test_run'] }],
    [P('/repo/tests/module_test.py'), { imports: [], exports: ['test_run_alt'] }],
    [P('/repo/tests/other_test.py'), { imports: [], exports: ['test_other'] }],

    // Cross-language negative guard
    [P('/repo/src/server/auth/login.js'), { imports: [], exports: ['login'] }],
    [P('/repo/src/test/java/server/auth/LoginTests.java'), { imports: [], exports: ['LoginTests'] }],
  ]);

  depGraph.reverseGraph = new Map([
    [P('/repo/src/core/util.ts'), [P('/repo/src/core/index.ts')]],
    [P('/repo/src/core/index.ts'), [P('/repo/src/app.ts')]],
    [P('/repo/src/app.ts'), [P('/repo/test/app.test.ts')]],
  ]);

  return depGraph;
}

function normalizeList(rows) {
  return Array.from(new Set((rows || []).map((row) => String(row.file || '').replace(/\\/g, '/').toLowerCase())));
}

function evaluate(predicted, expected) {
  const p = new Set(predicted);
  const e = new Set(expected);
  let tp = 0;
  for (const item of p) {
    if (e.has(item)) tp += 1;
  }
  const fp = Math.max(0, p.size - tp);
  const fn = Math.max(0, e.size - tp);
  const precision = p.size === 0 ? 1 : tp / p.size;
  const recall = e.size === 0 ? 1 : tp / e.size;
  return { tp, fp, fn, precision, recall };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function main() {
  const depGraph = makeDepGraph();
  const P = (value) => depGraph.normalizeFilePath(value);

  const scenarios = [
    {
      name: 'js-barrel-chain',
      source: P('/repo/src/core/util.ts'),
      expected: [P('/repo/test/app.test.ts')],
    },
    {
      name: 'python-mixed-tests-layout',
      source: P('/repo/pkg/module.py'),
      expected: [P('/repo/tests/test_module.py'), P('/repo/tests/module_test.py')],
    },
    {
      name: 'cross-language-guard',
      source: P('/repo/src/server/auth/login.js'),
      expected: [],
    },
  ];

  const rows = scenarios.map((scenario) => {
    const baselineRows = depGraph.findAffectedTests(scenario.source, 5, { includeHeuristic: false });
    const enhancedRows = depGraph.findAffectedTests(scenario.source, 5, { includeHeuristic: true });

    const baseline = evaluate(normalizeList(baselineRows), normalizeList(scenario.expected.map((x) => ({ file: x }))));
    const enhanced = evaluate(normalizeList(enhancedRows), normalizeList(scenario.expected.map((x) => ({ file: x }))));

    return {
      scenario: scenario.name,
      source: String(scenario.source).replace(/\\/g, '/'),
      baseline: {
        ...baseline,
        precision: round2(baseline.precision),
        recall: round2(baseline.recall),
      },
      enhanced: {
        ...enhanced,
        precision: round2(enhanced.precision),
        recall: round2(enhanced.recall),
      },
      delta: {
        precision: round2(enhanced.precision - baseline.precision),
        recall: round2(enhanced.recall - baseline.recall),
      },
    };
  });

  const summary = rows.reduce(
    (acc, item) => {
      acc.baselinePrecision += item.baseline.precision;
      acc.baselineRecall += item.baseline.recall;
      acc.enhancedPrecision += item.enhanced.precision;
      acc.enhancedRecall += item.enhanced.recall;
      return acc;
    },
    {
      baselinePrecision: 0,
      baselineRecall: 0,
      enhancedPrecision: 0,
      enhancedRecall: 0,
    }
  );

  const count = rows.length || 1;
  const report = {
    generatedAt: new Date().toISOString(),
    model: 'graph-only vs enhanced-heuristic',
    scenarioCount: rows.length,
    averages: {
      baselinePrecision: round2(summary.baselinePrecision / count),
      baselineRecall: round2(summary.baselineRecall / count),
      enhancedPrecision: round2(summary.enhancedPrecision / count),
      enhancedRecall: round2(summary.enhancedRecall / count),
      precisionDelta: round2((summary.enhancedPrecision - summary.baselinePrecision) / count),
      recallDelta: round2((summary.enhancedRecall - summary.baselineRecall) / count),
    },
    scenarios: rows,
  };

  const reportDir = path.join(__dirname, '..', 'reports');
  fs.mkdirSync(reportDir, { recursive: true });
  const outputPath = path.join(reportDir, 'roadmap-m3-mapping-hitrate-compare.json');
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));

  console.log(`mapping-hitrate-compare: wrote ${outputPath}`);
  console.log(JSON.stringify(report.averages, null, 2));
}

main();
