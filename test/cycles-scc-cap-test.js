#!/usr/bin/env node
// @semantic — cycles 组合爆炸治理：per-SCC cap + sccCount + 显式截断标记
// 复现 2026-07-20 dogfood 问题：单个稠密 SCC 枚举 100+ 条环路径（组合爆炸），
// 且上cap触发时完全静默；curated 计数与 raw 输出之间没有可信桥梁。
const assert = require('assert');
const { normalizePathKey } = require('../src/utils/path');
const { createMockDepGraph } = require('./test-helpers');
const { LIMITS } = require('../src/config/constants');
const { formatSummary } = require('../src/cli/formatters/human-formatters');
const cyclesTool = require('../src/tools/dep-tools/cycles');

function n(p) {
  return normalizePathKey(p);
}

function fullyConnectedSchema(prefix, size) {
  const schema = {};
  for (let i = 0; i < size; i++) {
    const file = n(`/repo/${prefix}${i}.js`);
    const others = [];
    for (let j = 0; j < size; j++) {
      if (j === i) continue;
      others.push(n(`/repo/${prefix}${j}.js`));
    }
    schema[file] = {
      imports: others,
      exports: [],
      importRecords: others.map((t) => ({ source: `./${t}`, imported: [], resolved: t })),
      exportRecords: [],
      parseMode: 'ast',
      parseModeReason: 'ast-success',
    };
  }
  return schema;
}

function triangleSchema(prefix) {
  const a = n(`/repo/${prefix}a.js`);
  const b = n(`/repo/${prefix}b.js`);
  const c = n(`/repo/${prefix}c.js`);
  return {
    [a]: { imports: [b], exports: [], importRecords: [{ source: './b', imported: [], resolved: b }], exportRecords: [], parseMode: 'ast' },
    [b]: { imports: [c], exports: [], importRecords: [{ source: './c', imported: [], resolved: c }], exportRecords: [], parseMode: 'ast' },
    [c]: { imports: [a], exports: [], importRecords: [{ source: './a', imported: [], resolved: a }], exportRecords: [], parseMode: 'ast' },
  };
}

function testPerSccCapAndMeta() {
  const dg = createMockDepGraph({ schema: fullyConnectedSchema('d', 8) });
  const cycles = dg.findCircularDependencies({ skipCache: true });
  const meta = dg.getCycleMeta();
  assert.strictEqual(meta.sccCount, 1, 'one dense SCC');
  assert.strictEqual(meta.truncated, true, 'per-SCC cap must flag truncation explicitly');
  assert.ok(cycles.length <= LIMITS.PER_SCC_CYCLE_CAP, `paths must be capped at ${LIMITS.PER_SCC_CYCLE_CAP}, got ${cycles.length}`);
}

function testNoStarvationAcrossSccs() {
  const dg = createMockDepGraph({
    schema: { ...fullyConnectedSchema('d', 8), ...triangleSchema('t') },
  });
  const cycles = dg.findCircularDependencies({ skipCache: true });
  const meta = dg.getCycleMeta();
  assert.strictEqual(meta.sccCount, 2, 'two SCCs');
  assert.strictEqual(meta.truncated, true);
  const trianglePath = cycles.find((cyc) => cyc.some((f) => f.includes('ta.js')));
  assert(trianglePath, 'small SCC paths must survive the dense SCC hitting its cap (no starvation)');
}

function testSimpleCycleNotTruncated() {
  const dg = createMockDepGraph({ schema: triangleSchema('s') });
  const cycles = dg.findCircularDependencies({ skipCache: true });
  const meta = dg.getCycleMeta();
  assert.strictEqual(meta.sccCount, 1);
  assert.strictEqual(meta.truncated, false, 'no cap hit → not truncated');
  assert.strictEqual(cycles.length, 1, 'pure triangle yields exactly one simple cycle');
}

function testCyclesToolOutput() {
  const dg = createMockDepGraph({ schema: fullyConnectedSchema('d', 8) });
  const container = { snapshot: { graph: dg } };
  const result = cyclesTool([], container, null);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.sccCount, 1, 'tool exposes curated sccCount');
  assert.strictEqual(result.totalPaths, result.cyclesCount, 'totalPaths mirrors full path count');
  assert.strictEqual(result.truncated, true, 'tool flags truncation');
  assert.ok(result.cycles.length <= LIMITS.OUTPUT_EXTRA_LONG, 'tool truncates path list for output');
  assert.strictEqual(typeof result.cyclesCount, 'number', 'cyclesCount keeps path-count semantics (back-compat)');
}

function testCyclesSummaryFormatterShowsMore() {
  const result = {
    ok: true,
    cyclesCount: 40,
    sccCount: 1,
    totalPaths: 40,
    truncated: true,
    cycles: [['/repo/a.js', '/repo/b.js'], ['/repo/b.js', '/repo/c.js'], ['/repo/c.js', '/repo/a.js'], ['/repo/a.js', '/repo/c.js']],
  };
  const out = formatSummary('cycles', result);
  assert(out.includes('in 1 SCC(s)'), `summary should name SCC count: ${out}`);
  assert(out.includes('more cycle paths'), `summary must show "... more cycle paths": ${out}`);
}

function main() {
  testPerSccCapAndMeta();
  testNoStarvationAcrossSccs();
  testSimpleCycleNotTruncated();
  testCyclesToolOutput();
  testCyclesSummaryFormatterShowsMore();
  console.log('cycles-scc-cap-test: all assertions passed');
}

main();
