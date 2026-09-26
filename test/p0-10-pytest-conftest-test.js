#!/usr/bin/env node
// @semantic
// @fast — in-memory mock DependencyGraph
//
// P0-10（审查报告 §4）：pytest 的 conftest.py 对工具不可见。
// pytest 按参数名注入 fixture，import 图看不到 conftest → 测试这层关系，
// 所以两个方向都在 affected-tests / impact 查询时补隐式依赖（不造 fake import 边）：
//   1. 方向一：改 conftest.py → 其目录及子目录下所有测试受影响。
//   2. 方向二：改 conftest import 的代码（直接或传递）→ 映射到该目录下的测试。
//   3. conftest.py 不是测试：任何方向的 affected-tests 结果都不许出现它。
//   4. warm（含旧版缓存可能残留的 conftest 行）与 cold 同答；impact 同步补隐式行。
//
// 启发式局限（本测试逐条锁住）：
//   - 不做 fixture 参数名匹配：锚点是「conftest 是否在 import 图里 import 了改动文件」。
//     因此是过近似：不用该 fixture 的 test_b 也会被报（pytest 语义上 conftest 变更
//     本就影响其作用域内全部测试，过近似方向安全）。
//   - 作用域 = conftest 目录前缀 × isTestLikeFile：tests/ 下 pytest 不会执行的
//     helpers.py 也会被报（路径规则把 /tests/ 下一切都当测试文件）；conftest 目录
//     之外的 test_outside.py 不报。
//   - 传递链受 maxDepth 限制：改动文件离 conftest 超过 maxDepth 跳 → 漏报。
//   - 只认 import 图里存在的边：fixture 代码经插件 / pytest_plugins 从图外加载 → 漏报
//     （结构分析的能力圈，不靠语义猜测硬补）。

const assert = require('assert');
const { createMockDepGraph } = require('./test-helpers');

const factoryKey = '/repo/app/factory.py';
const supportKey = '/repo/app/support.py';
const conftestKey = '/repo/tests/conftest.py';
const helpersKey = '/repo/tests/helpers.py';
const testAKey = '/repo/tests/unit/test_a.py';
const testBKey = '/repo/tests/unit/test_b.py';
const outsideKey = '/repo/qa/test_outside.py';

// conftest 只 import support（support 才 import factory）——方向二必须走传递链。
function makeGraph() {
  return createMockDepGraph({
    schema: {
      [factoryKey]: { imports: [], exports: ['make'] },
      [supportKey]: { imports: [factoryKey], exports: ['wrap'] },
      [conftestKey]: { imports: [supportKey], exports: ['thing'] },
      [helpersKey]: { imports: [], exports: ['setup'] },
      [testAKey]: { imports: [], exports: ['test_a'] },
      [testBKey]: { imports: [], exports: ['test_b'] },
      [outsideKey]: { imports: [], exports: ['test_outside'] },
    },
  });
}

const names = (rows) => rows.map((r) => r.file);

// 方向一：改 conftest.py → 目录及子目录下所有测试；conftest 自身 / 作用域外测试不出现
function testConftestChangeAffectsSubtree() {
  const dg = makeGraph();
  const results = dg.findAffectedTests(conftestKey);
  const got = names(results).sort();

  assert.ok(got.includes(testAKey), `tests/unit/test_a.py must be affected, got ${JSON.stringify(got)}`);
  assert.ok(got.includes(testBKey), `tests/unit/test_b.py must be affected, got ${JSON.stringify(got)}`);
  // 过近似（有意为之）：test_b 不使用 fixture，但 conftest 变更影响整个作用域
  assert.ok(got.includes(helpersKey), `tests/helpers.py is test-like under tests/ → reported (documented over-approx), got ${JSON.stringify(got)}`);
  assert.ok(!got.includes(conftestKey), `conftest.py itself must never be listed, got ${JSON.stringify(got)}`);
  assert.ok(!got.includes(outsideKey), `test outside the conftest subtree must not be affected, got ${JSON.stringify(got)}`);

  const row = results.find((r) => r.file === testAKey);
  assert.strictEqual(row.source, 'conftest', `implicit row must carry source 'conftest', got ${JSON.stringify(row)}`);
  assert.strictEqual(row.distance, 1, `conftest → subtree test is one implicit hop, got ${JSON.stringify(row)}`);
}

// 方向二：改 factory.py（conftest 经 support 传递 import）→ 同作用域测试；conftest 不出现
function testFixtureCodeAffectsSubtreeTestsNotConftest() {
  const dg = makeGraph();
  const results = dg.findAffectedTests(factoryKey);
  const got = names(results).sort();

  assert.ok(got.includes(testAKey), `test_a.py must be affected via conftest, got ${JSON.stringify(got)}`);
  assert.ok(got.includes(testBKey), `test_b.py must be affected via conftest, got ${JSON.stringify(got)}`);
  assert.ok(!got.includes(conftestKey), `conftest.py must not be listed as an affected test, got ${JSON.stringify(got)}`);
  assert.ok(!got.includes(outsideKey), `test outside the conftest subtree must not be affected, got ${JSON.stringify(got)}`);

  const row = results.find((r) => r.file === testAKey);
  assert.strictEqual(row.source, 'conftest', `implicit row must carry source 'conftest', got ${JSON.stringify(row)}`);
  // 传递链 factory ← support ← conftest = 2 跳，conftest → test 再 1 跳
  assert.strictEqual(row.distance, 3, `distance = dependents hops to conftest + 1, got ${JSON.stringify(row)}`);
}

// 局限（锁语义）：传递链受 maxDepth 限制——深度 2 到不了 conftest（第 2 跳）之外的测试
function testDepthCapAppliesToImplicitRows() {
  const dg = makeGraph();
  const results = dg.findAffectedTests(factoryKey, 2);
  const got = names(results);
  assert.deepStrictEqual(got, [], `implicit rows respect maxDepth (distance 3 > 2), got ${JSON.stringify(got)}`);
}

// warm：旧版缓存可能存有 conftest 行（当时它被当测试文件）——fast path 服务后必须
// ① 滤掉 conftest ② 活补隐式行，与 cold 逐字段一致
function testWarmOldCacheStillFiltersAndAugments() {
  const dg = makeGraph();
  dg.analyzer.injectPrecomputedTestMap([
    { source: factoryKey, testFile: conftestKey, distance: 2, signal: 'import' },
  ]);
  const results = dg.findAffectedTests(factoryKey);
  const got = names(results).sort();

  assert.ok(!got.includes(conftestKey), `old cached conftest row must be filtered, got ${JSON.stringify(got)}`);
  assert.ok(got.includes(testAKey), `implicit rows must be added on the warm path too, got ${JSON.stringify(got)}`);
  const row = results.find((r) => r.file === testAKey);
  assert.strictEqual(row.source, 'conftest', `warm implicit row must carry source 'conftest', got ${JSON.stringify(row)}`);
  assert.strictEqual(row.distance, 3, `warm distance must match cold, got ${JSON.stringify(row)}`);

  // 与 cold 逐字段一致（file/distance/source）
  const cold = makeGraph().findAffectedTests(factoryKey);
  assert.deepStrictEqual(
    results.map((r) => `${r.file}@${r.distance}/${r.source}`).sort(),
    cold.map((r) => `${r.file}@${r.distance}/${r.source}`).sort(),
    'warm and cold affected-tests must agree'
  );
}

// 根 conftest（不在 tests/ 下 → isTestLikeFile 为 false，旧逻辑根本查不到）同样生效，
// 作用域 = 所在目录（根 = 全仓）
function testRootConftestNotTestLikeStillAnchors() {
  const dg = createMockDepGraph({
    schema: {
      [factoryKey]: { imports: [], exports: ['make'] },
      '/repo/conftest.py': { imports: [factoryKey], exports: ['thing'] },
      '/repo/tests/test_x.py': { imports: [], exports: ['test_x'] },
      '/repo/pkg/test_y.py': { imports: [], exports: ['test_y'] },
    },
  });
  const results = dg.findAffectedTests('/repo/conftest.py');
  const got = names(results).sort();

  assert.ok(got.includes('/repo/tests/test_x.py'), `root conftest scopes to whole repo, got ${JSON.stringify(got)}`);
  assert.ok(got.includes('/repo/pkg/test_y.py'), `root conftest scopes to whole repo, got ${JSON.stringify(got)}`);
  assert.ok(!got.includes('/repo/conftest.py'), 'conftest must never be listed, got ' + JSON.stringify(got));
}

// impact 方向一：改 conftest.py → 影响半径 = 作用域内测试（reason: implicit-conftest）
function testImpactDirection1() {
  const dg = makeGraph();
  const rows = dg.getImpactRadius(conftestKey, 5);
  const got = names(rows);

  assert.ok(got.includes(testAKey), `impact of conftest must include subtree tests, got ${JSON.stringify(got)}`);
  assert.ok(!got.includes(conftestKey), 'conftest must not list itself, got ' + JSON.stringify(got));
  assert.ok(!got.includes(outsideKey), 'test outside subtree must not be impacted, got ' + JSON.stringify(got));
  const row = rows.find((r) => r.file === testAKey);
  assert.strictEqual(row.reason, 'implicit-conftest', `implicit impact rows must be labeled, got ${JSON.stringify(row)}`);
  assert.strictEqual(row.level, 1, `conftest → subtree test is level 1, got ${JSON.stringify(row)}`);
}

// impact 方向二：改 factory.py → 真实边到 conftest 保留，作用域测试经隐式边补进半径
function testImpactDirection2() {
  const dg = makeGraph();
  const rows = dg.getImpactRadius(factoryKey, 5);
  const got = names(rows);

  assert.ok(got.includes(supportKey), `real dependents stay, got ${JSON.stringify(got)}`);
  assert.ok(got.includes(conftestKey), `conftest is a real dependent of factory (impact ≠ affected-tests), got ${JSON.stringify(got)}`);
  assert.ok(got.includes(testAKey), `subtree tests must be reached via the implicit edge, got ${JSON.stringify(got)}`);

  const implicit = rows.find((r) => r.file === testAKey);
  assert.strictEqual(implicit.reason, 'implicit-conftest', `got ${JSON.stringify(implicit)}`);
  assert.strictEqual(implicit.level, 3, `factory ←(1) support ←(2) conftest ←(3) test, got ${JSON.stringify(implicit)}`);

  // warm（precompute 注入分支）与 cold 同答
  const coldFiles = got.slice().sort();
  dg.analyzer.precomputeImpact();
  const warmRows = dg.getImpactRadius(factoryKey, 5);
  assert.deepStrictEqual(names(warmRows).sort(), coldFiles, 'precomputed impact branch must serve the same implicit rows');
  const warmImplicit = warmRows.find((r) => r.file === testAKey);
  assert.strictEqual(warmImplicit.reason, 'implicit-conftest', `got ${JSON.stringify(warmImplicit)}`);
}

function main() {
  testConftestChangeAffectsSubtree();
  testFixtureCodeAffectsSubtreeTestsNotConftest();
  testDepthCapAppliesToImplicitRows();
  testWarmOldCacheStillFiltersAndAugments();
  testRootConftestNotTestLikeStillAnchors();
  testImpactDirection1();
  testImpactDirection2();
  console.log('p0-10-pytest-conftest-test: all passed');
}

main();
