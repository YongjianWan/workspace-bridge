#!/usr/bin/env node

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { buildProjectOverview } = require('../src/tools/overview-tools');

const root = path.resolve('C:/tmp/overview-fixture');
const fileA = path.join(root, 'src', 'a.js');
const fileB = path.join(root, 'src', 'b.js');
const fileApp = path.join(root, 'src', 'app.js');
const fileTest = path.join(root, 'test', 'app.test.js');
const fileDoc = path.join(root, 'README.md');

const dependentsMap = new Map([
  [fileA, [fileB, fileApp, fileTest]],
  [fileB, [fileApp]],
  [fileApp, [fileTest]],
  [fileTest, []],
  [fileDoc, []],
]);

const dependenciesMap = new Map([
  [fileA, []],
  [fileB, [fileA]],
  [fileApp, [fileA, fileB]],
  [fileTest, [fileApp]],
  [fileDoc, []],
]);

const depGraph = {
  graph: new Map([
    [fileA, {}],
    [fileB, {}],
    [fileApp, {}],
    [fileTest, {}],
    [fileDoc, {}],
  ]),
  entryFiles: new Set([fileApp]),
  projectContext: {
    classifyFile(file) {
      const rel = path.relative(root, file).replace(/\\/g, '/');
      const isMainline = !rel.startsWith('test/');
      let fileRole = 'library';
      if (rel.endsWith('app.js')) fileRole = 'entry';
      if (rel.endsWith('.md')) fileRole = 'config';
      if (rel.includes('.test.')) fileRole = 'test';
      return { isMainline, fileRole };
    },
  },
  getDependents(file) {
    return dependentsMap.get(file) || [];
  },
  getDependencies(file) {
    return dependenciesMap.get(file) || [];
  },
  findCircularDependencies() {
    return [[fileA, fileB, fileA]];
  },
  isTestLikeFile(file) {
    return /\.test\./.test(path.basename(file));
  },
};

const container = {
  workspaceRoot: root,
  depGraph,
  async ensureReady() {
    return true;
  },
};

async function main() {
  const calls = [];
  const historyProvider = async (calledRoot, file) => {
    calls.push({ calledRoot, file });
    assert.strictEqual(calledRoot, root, 'historyProvider first arg should be root');
    const riskByFile = {
      [fileA]: { level: 'high', commitCount: 8, authorCount: 3, lastModifiedDaysAgo: 2, revertLikeCount: 1, signals: ['hotspot A'] },
      [fileB]: { level: 'medium', commitCount: 4, authorCount: 2, lastModifiedDaysAgo: 10, revertLikeCount: 0, signals: ['hotspot B'] },
      [fileApp]: { level: 'low', commitCount: 1, authorCount: 1, lastModifiedDaysAgo: 40, revertLikeCount: 0, signals: ['quiet'] },
      [fileTest]: { level: 'low', commitCount: 1, authorCount: 1, lastModifiedDaysAgo: 20, revertLikeCount: 0, signals: ['test'] },
      [fileDoc]: { level: 'low', commitCount: 0, authorCount: 1, lastModifiedDaysAgo: null, revertLikeCount: 0, signals: ['doc'] },
    };
    return { ok: true, historyRisk: riskByFile[file] || null, recentCommits: [] };
  };

  const result = await buildProjectOverview({ historyProvider }, container);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.workspaceRoot, root);
  assert.strictEqual(result.skeleton.totalFiles, 5);
  assert(result.skeleton.coreModules.some((entry) => entry.file.endsWith('src/a.js')));
  assert(Array.isArray(result.hotspots));
  assert(result.hotspots.length >= 1);
  assert(Array.isArray(result.stability));
  assert(result.stability.length >= 1);
  assert(typeof result.orphans.counts.total === 'number');
  assert(Array.isArray(result.summary.insights));
  assert(Array.isArray(result.summary.recommendations));
  assert(result.architectureAdvice, 'architectureAdvice should exist');
  assert(Array.isArray(result.architectureAdvice.cycleRefactorSuggestions), 'cycleRefactorSuggestions should exist');
  assert(result.architectureAdvice.cycleRefactorSuggestions.length >= 1, 'should include cycle refactor suggestions');
  const firstCycleSuggestion = result.architectureAdvice.cycleRefactorSuggestions[0];
  assert(firstCycleSuggestion.breakCandidate?.from, 'cycle suggestion should include breakCandidate.from');
  assert(firstCycleSuggestion.breakCandidate?.to, 'cycle suggestion should include breakCandidate.to');
  assert(firstCycleSuggestion.validation?.command, 'cycle suggestion should include validation command');
  assert(result.aggregates, 'aggregates should exist');
  assert(result.hotspotData, 'hotspotData should exist');
  assert.strictEqual(typeof result.hotspotData.schemaVersion, 'number');
  assert(Array.isArray(result.hotspotData.hotspots), 'hotspotData.hotspots should exist');
  assert(result.stabilityTrend, 'stabilityTrend should exist');
  assert.strictEqual(result.stabilityTrend.granularity, 'day');
  assert(Array.isArray(result.stabilityTrend.series), 'stabilityTrend.series should exist');
  assert.strictEqual(typeof result.stabilityTrend.latest.stabilityScore, 'number');
  assert.strictEqual(typeof result.stabilityTrend.latest.fragileCount, 'number');
  assert.strictEqual(typeof result.stabilityTrend.latest.hotspotsByRisk.high, 'number');
  assert.strictEqual(typeof result.aggregates.hotspotsByRisk.high, 'number');
  assert.strictEqual(typeof result.aggregates.stabilityCounts.fragile, 'number');
  assert(calls.length >= 1, 'history provider should be called');
  assert(!result.orphans.samples.modules.some((item) => item.includes('.test.')), 'test files should not be reported as orphan modules');

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-overview-'));
  const outFile = path.join(outDir, 'hotspots.json');
  const resultWithFile = await buildProjectOverview({ historyProvider, hotspotData: outFile }, container);
  assert.strictEqual(resultWithFile.hotspotDataFile, outFile);
  assert(fs.existsSync(outFile), 'hotspot data file should be written');
  const parsed = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  assert.strictEqual(parsed.schemaVersion, 1);
  assert(Array.isArray(parsed.hotspots));
  const trendFile = path.join(outDir, 'trend.json');
  const firstRun = await buildProjectOverview({
    historyProvider,
    stabilityTrendData: trendFile,
    trendGranularity: 'week',
    now: '2026-04-02T00:00:00.000Z',
  }, container);
  assert.strictEqual(firstRun.stabilityTrendDataFile, trendFile);
  const secondRun = await buildProjectOverview({
    historyProvider,
    stabilityTrendData: trendFile,
    trendGranularity: 'week',
    now: '2026-04-09T00:00:00.000Z',
  }, container);
  assert.strictEqual(secondRun.stabilityTrendDataFile, trendFile);
  const trendParsed = JSON.parse(fs.readFileSync(trendFile, 'utf8'));
  assert.strictEqual(trendParsed.schemaVersion, 1);
  assert.strictEqual(trendParsed.granularity, 'week');
  assert(Array.isArray(trendParsed.history));
  assert(trendParsed.history.length >= 2, 'trend history should append snapshots');
  assert(Array.isArray(trendParsed.series));
  assert(trendParsed.series.length >= 2, 'trend series should include weekly buckets');
  fs.rmSync(outDir, { recursive: true, force: true });

  console.log('overview-tools-test: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
