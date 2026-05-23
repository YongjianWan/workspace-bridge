#!/usr/bin/env node
/**
 * Overview Curator — direct unit tests for pure computation / curation logic.
 * Previously zero-coverage; these tests protect against refactoring regressions
 * in recommendation generation, severity scoring, and stack-profile wording.
 */
const assert = require('assert');
const {
  buildOverviewSummary,
  buildCycleRefactorSuggestions,
  buildCouplingSplitSuggestions,
  calculateCoupling,
} = require('../src/tools/overview-curator');
const { createMockDepGraph } = require('./test-helpers');

// ── buildOverviewSummary ───────────────────────────────────────────────────

function testBuildOverviewSummaryEmpty() {
  const result = buildOverviewSummary([], [], { all: [], modules: [] });
  assert.strictEqual(result.summary.severity, 'low');
  assert.deepStrictEqual(result.summary.insights, []);
  assert.deepStrictEqual(result.summary.recommendations, []);
  assert.strictEqual(result.orphanCount, 0);
}

function testBuildOverviewSummaryWithIssues() {
  const result = buildOverviewSummary(
    [{ file: 'src/a.js' }],
    [{ assessment: 'fragile' }],
    { all: ['src/orphan.js'], modules: ['src/orphan.js'] },
    { unresolved: { count: 2 }, cycles: { count: 1 }, deadExports: { count: 3 } },
    'node-first',
    null,
    [{ breakCandidate: { from: 'src/a.js' } }],
    [{ file: 'src/b.js' }]
  );
  assert.strictEqual(result.summary.severity, 'high');
  assert(result.summary.insights.some((i) => i.includes('热区')));
  assert(result.summary.insights.some((i) => i.includes('稳定性较差')));
  assert(result.summary.insights.some((i) => i.includes('孤儿')));
  assert(result.summary.insights.some((i) => i.includes('未解析')));
  assert(result.summary.insights.some((i) => i.includes('循环依赖')));
  assert(result.summary.insights.some((i) => i.includes('死导出')));
  assert(result.summary.recommendations.some((r) => r.includes('unresolved')));
  assert(result.summary.recommendations.some((r) => r.includes('dependency cycle')));
  assert(result.summary.recommendations.some((r) => r.includes('dead exports')));
  assert(result.summary.recommendations.some((r) => r.includes('优先审查热区文件')));
  assert(result.summary.recommendations.some((r) => r.includes('为脆弱模块添加测试')));
  assert(result.summary.recommendations.some((r) => r.includes('审查孤儿模块')));
  assert(result.summary.recommendations.some((r) => r.includes('先处理循环依赖')));
  assert(result.summary.recommendations.some((r) => r.includes('高耦合模块拆分优先级')));
  assert(result.summary.recommendations.some((r) => r.includes('Node')));
}

function testBuildOverviewSummaryStackProfiles() {
  const stacks = ['node-first', 'java-first', 'python-first', 'go-first', 'rust-first', 'unknown'];
  const expectedKeywords = {
    'node-first': 'Node',
    'java-first': 'Java',
    'python-first': 'Python',
    'go-first': 'Go',
    'rust-first': 'Rust',
    'unknown': undefined, // no stack-specific tail
  };
  for (const stack of stacks) {
    const result = buildOverviewSummary([], [], { all: [], modules: [] }, {}, stack);
    const recs = result.summary.recommendations;
    if (expectedKeywords[stack]) {
      assert(
        recs.some((r) => r.includes(expectedKeywords[stack])),
        `${stack} should include stack-specific recommendation`
      );
    } else {
      assert(
        !recs.some((r) => /Node|Java|Python|Go|Rust/.test(r)),
        'unknown stack should not inject stack-specific advice'
      );
    }
  }
}

function testBuildOverviewSummarySeverityLevels() {
  // low: nothing
  const low = buildOverviewSummary([], [], { all: [], modules: [] });
  assert.strictEqual(low.summary.severity, 'low');

  // medium: fragile modules push it
  const medium = buildOverviewSummary([], [{ assessment: 'fragile' }], { all: [], modules: [] });
  assert.strictEqual(medium.summary.severity, 'medium');

  // high: unresolved > 0
  const high = buildOverviewSummary([], [], { all: [], modules: [] }, { unresolved: { count: 1 } });
  assert.strictEqual(high.summary.severity, 'high');
}

// ── buildCycleRefactorSuggestions ──────────────────────────────────────────

function testBuildCycleRefactorSuggestionsBasic() {
  const depGraph = createMockDepGraph({
    mode: 'stub',
    schema: {
      '/repo/src/a.js': { imports: ['/repo/src/b.js'], exports: [], importRecords: [{ source: './b', resolved: '/repo/src/b.js' }], parseMode: 'ast' },
      '/repo/src/b.js': { imports: ['/repo/src/c.js'], exports: [], importRecords: [{ source: './c', resolved: '/repo/src/c.js' }], parseMode: 'ast' },
      '/repo/src/c.js': { imports: ['/repo/src/a.js'], exports: [], importRecords: [{ source: './a', resolved: '/repo/src/a.js' }], parseMode: 'ast' },
    },
    cycles: [['/repo/src/a.js', '/repo/src/b.js', '/repo/src/c.js', '/repo/src/a.js']],
    projectContext: { classifyFile: () => ({ fileRole: 'library' }) },
  });

  const suggestions = buildCycleRefactorSuggestions('/repo', depGraph, depGraph.projectContext);
  assert.strictEqual(suggestions.length, 1);
  assert.strictEqual(suggestions[0].cycleId, 'cycle-1');
  assert.strictEqual(suggestions[0].cycleSize, 3);
  assert(suggestions[0].breakCandidate.from);
  assert(suggestions[0].breakCandidate.to);
  assert(suggestions[0].validation.command);
}

function testBuildCycleRefactorSuggestionsEmpty() {
  const depGraph = createMockDepGraph({
    mode: 'stub',
    schema: {},
    cycles: [],
  });
  const suggestions = buildCycleRefactorSuggestions('/repo', depGraph, null);
  assert.deepStrictEqual(suggestions, []);
}

// ── buildCouplingSplitSuggestions ──────────────────────────────────────────

function testBuildCouplingSplitSuggestionsBasic() {
  const depGraph = createMockDepGraph({
    mode: 'stub',
    schema: {
      '/repo/src/core.js': {
        imports: ['/repo/src/a.js', '/repo/src/b.js', '/repo/src/c.js', '/repo/src/d.js'],
        exports: ['x'],
        exportRecords: [{ name: 'x' }],
        importRecords: [
          { source: './a', resolved: '/repo/src/a.js' },
          { source: './b', resolved: '/repo/src/b.js' },
          { source: './c', resolved: '/repo/src/c.js' },
          { source: './d', resolved: '/repo/src/d.js' },
        ],
        parseMode: 'ast',
      },
      '/repo/src/a.js': { imports: ['/repo/src/core.js'], exports: [], importRecords: [{ source: './core', resolved: '/repo/src/core.js' }], parseMode: 'ast' },
      '/repo/src/b.js': { imports: ['/repo/src/core.js'], exports: [], importRecords: [{ source: './core', resolved: '/repo/src/core.js' }], parseMode: 'ast' },
      '/repo/src/c.js': { imports: ['/repo/src/core.js'], exports: [], importRecords: [{ source: './core', resolved: '/repo/src/core.js' }], parseMode: 'ast' },
      '/repo/src/d.js': { imports: ['/repo/src/core.js'], exports: [], importRecords: [{ source: './core', resolved: '/repo/src/core.js' }], parseMode: 'ast' },
    },
    projectContext: { classifyFile: () => ({ isMainline: true, fileRole: 'library' }) },
  });

  const mainlineFiles = [
    '/repo/src/core.js',
    '/repo/src/a.js',
    '/repo/src/b.js',
    '/repo/src/c.js',
    '/repo/src/d.js',
  ];

  const suggestions = buildCouplingSplitSuggestions('/repo', depGraph, mainlineFiles, depGraph.projectContext);
  assert(suggestions.length > 0, 'should detect high-coupling candidates');
  const coreSuggestion = suggestions.find((s) => s.file === 'src/core.js');
  assert(coreSuggestion, 'core.js should be flagged as over-coupled');
  assert.strictEqual(coreSuggestion.coupling.level, 'low');
  assert(coreSuggestion.splitPlan.length > 0);
  assert(coreSuggestion.validation.command);
}

function testBuildCouplingSplitSuggestionsSmallProjectSuppress() {
  const depGraph = createMockDepGraph({
    mode: 'stub',
    schema: {
      '/repo/src/lib.js': { imports: [], exports: ['x'], exportRecords: [{ name: 'x' }], importRecords: [], parseMode: 'ast' },
      '/repo/src/a.js': { imports: ['/repo/src/lib.js'], exports: [], importRecords: [{ source: './lib', resolved: '/repo/src/lib.js' }], parseMode: 'ast' },
    },
    projectContext: { classifyFile: () => ({ isMainline: true, fileRole: 'library' }) },
  });

  const suggestions = buildCouplingSplitSuggestions('/repo', depGraph, ['/repo/src/lib.js', '/repo/src/a.js'], depGraph.projectContext);
  // small project (< 200 mainline files) suppresses aggressive split advice for library role
  if (suggestions.length > 0) {
    assert(
      suggestions[0].splitPlan.some((p) => p.includes('规模较小') || p.includes('内聚')),
      'small project should suggest cohesion over split'
    );
  }
}

function testBuildCouplingSplitSuggestionsHighOutDegree() {
  const depGraph = createMockDepGraph({
    mode: 'stub',
    schema: {
      '/repo/src/orchestrator.js': {
        imports: ['/repo/src/a.js', '/repo/src/b.js', '/repo/src/c.js', '/repo/src/d.js', '/repo/src/e.js', '/repo/src/f.js', '/repo/src/g.js', '/repo/src/h.js'],
        exports: [],
        importRecords: [
          { source: './a', resolved: '/repo/src/a.js' },
          { source: './b', resolved: '/repo/src/b.js' },
          { source: './c', resolved: '/repo/src/c.js' },
          { source: './d', resolved: '/repo/src/d.js' },
          { source: './e', resolved: '/repo/src/e.js' },
          { source: './f', resolved: '/repo/src/f.js' },
          { source: './g', resolved: '/repo/src/g.js' },
          { source: './h', resolved: '/repo/src/h.js' },
        ],
        parseMode: 'ast',
      },
      '/repo/src/a.js': { imports: [], exports: [], importRecords: [], parseMode: 'ast' },
      '/repo/src/b.js': { imports: [], exports: [], importRecords: [], parseMode: 'ast' },
      '/repo/src/c.js': { imports: [], exports: [], importRecords: [], parseMode: 'ast' },
      '/repo/src/d.js': { imports: [], exports: [], importRecords: [], parseMode: 'ast' },
      '/repo/src/e.js': { imports: [], exports: [], importRecords: [], parseMode: 'ast' },
      '/repo/src/f.js': { imports: [], exports: [], importRecords: [], parseMode: 'ast' },
      '/repo/src/g.js': { imports: [], exports: [], importRecords: [], parseMode: 'ast' },
      '/repo/src/h.js': { imports: [], exports: [], importRecords: [], parseMode: 'ast' },
    },
    projectContext: {
      classifyFile() { return { isMainline: true, fileRole: 'library' }; },
    },
  });

  const mainlineFiles = Array.from({ length: 250 }, (_, i) => `/repo/src/f${i}.js`);
  mainlineFiles.push('/repo/src/orchestrator.js');
  const suggestions = buildCouplingSplitSuggestions('/repo', depGraph, mainlineFiles, depGraph.projectContext);
  assert(suggestions.length > 0, 'orchestrator should be flagged for high out-degree');
  assert(suggestions[0].splitPlan.some((p) => p.includes('零被依赖') || p.includes('outward')));
}

// ── calculateCoupling ──────────────────────────────────────────────────────

function testCalculateCouplingLow() {
  const c = calculateCoupling(['a.js'], ['b.js']);
  assert.strictEqual(c.inDegree, 1);
  assert.strictEqual(c.outDegree, 1);
  assert.strictEqual(c.total, 2);
  assert.strictEqual(c.level, 'low');
}

function testCalculateCouplingMedium() {
  // SCORING.COUPLING_MEDIUM_MIN = 10
  const deps = Array.from({ length: 6 }, (_, i) => `d${i}.js`);
  const dents = Array.from({ length: 6 }, (_, i) => `u${i}.js`);
  const c = calculateCoupling(deps, dents);
  assert.strictEqual(c.total, 12);
  assert.strictEqual(c.level, 'medium');
}

function testCalculateCouplingHigh() {
  // SCORING.COUPLING_HIGH_MIN = 20
  const deps = Array.from({ length: 11 }, (_, i) => `d${i}.js`);
  const dents = Array.from({ length: 11 }, (_, i) => `u${i}.js`);
  const c = calculateCoupling(deps, dents);
  assert.strictEqual(c.total, 22);
  assert.strictEqual(c.level, 'high');
}

function main() {
  testBuildOverviewSummaryEmpty();
  testBuildOverviewSummaryWithIssues();
  testBuildOverviewSummaryStackProfiles();
  testBuildOverviewSummarySeverityLevels();
  testBuildCycleRefactorSuggestionsBasic();
  testBuildCycleRefactorSuggestionsEmpty();
  testBuildCouplingSplitSuggestionsBasic();
  testBuildCouplingSplitSuggestionsSmallProjectSuppress();
  testBuildCouplingSplitSuggestionsHighOutDegree();
  testCalculateCouplingLow();
  testCalculateCouplingMedium();
  testCalculateCouplingHigh();
  console.log('overview-curator-test.js: all passed');
}

main();
