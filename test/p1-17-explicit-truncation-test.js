// @fast
// @semantic
// JSON 输出里任何被截短、清空或置空的地方都必须在顶层 `elided[]` 里有一条记录，
// 并把顶层 `truncated` 置为 true。agent 不会怀疑输出：看到 100 条就当总共 100 条。
//   - 兜底网 elideDeep：数组截断、长字符串截断、超深置空，逐条记 path / shown / total
//   - audit-file compact：截短的列表保留头部并同样记录，列表自身的 truncated 为 true
//   - 什么都没截时不出现 elided，truncated 保持生产方的原值
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { DEFAULTS } = require('../src/config/constants');
const { elideDeep } = require('../src/utils/truncate');
const { formatCliResult } = require('../src/cli/route-formatter');
const { runCliInProcess, makeTempDir, cleanupTempDir } = require('./test-helpers');

const range = (n) => Array.from({ length: n }, (_, i) => i);

function testElideDeepReportsEveryCut() {
  const elided = [];
  const input = {
    items: range(150),
    deadExports: [{ file: 'a.js', exports: range(120) }],
    nested: { text: 'x'.repeat(600) },
    a: { b: { c: { d: { e: 1 } } } },
  };
  elideDeep(input, { maxArrayLength: 100, maxStringLength: 500, maxDepth: 3, elided });
  const byPath = Object.fromEntries(elided.map((e) => [e.path, e]));
  assert.deepStrictEqual(byPath.items, { path: 'items', kind: 'array', shown: 100, total: 150, reason: 'json-size-limit' });
  assert.deepStrictEqual(byPath['deadExports[0].exports'], { path: 'deadExports[0].exports', kind: 'array', shown: 100, total: 120, reason: 'json-size-limit' });
  assert.deepStrictEqual(byPath['nested.text'], { path: 'nested.text', kind: 'string', shown: 500, total: 600, reason: 'json-size-limit' });
  assert.deepStrictEqual(byPath['a.b.c.d'], { path: 'a.b.c.d', kind: 'depth', shown: 0, total: null, reason: 'json-size-limit' }, `超深置空也要记录，实际 ${JSON.stringify(elided)}`);
}

function testJsonOutputSurfacesElision() {
  const result = { ok: true, dependentsCount: 212, dependents: range(212).map((i) => ({ file: `t${i}.py` })), truncated: false };
  const out = JSON.parse(formatCliResult({ format: 'json', json: true, command: 'dependents' }, result));
  assert.strictEqual(out.dependents.length, 100);
  assert.strictEqual(out.truncated, true, '列表被兜底网截短时顶层 truncated 不得是 false');
  assert.deepStrictEqual(out.elided, [{ path: 'dependents', kind: 'array', shown: 100, total: 212, reason: 'json-size-limit' }]);
}

function testJsonOutputUntouchedWhenNothingCut() {
  const result = { ok: true, affectedTestsCount: 3, affectedTests: range(3), truncated: false };
  const out = JSON.parse(formatCliResult({ format: 'json', json: true, command: 'affected-tests' }, result));
  assert.strictEqual(out.truncated, false);
  assert.ok(!('elided' in out), '没有截断时不应出现 elided');
}

function testExplicitMaxFilesBeatsSizeNet() {
  const result = { ok: true, affectedTestsCount: 212, affectedTests: range(212), truncated: false };
  const out = JSON.parse(formatCliResult({ format: 'json', json: true, command: 'affected-tests', maxFiles: 300 }, result));
  assert.strictEqual(out.affectedTests.length, 212, '显式 --max-files 300 不得被兜底网截回 100');
  assert.ok(!('elided' in out));
}

function testAffectedTestsSortedBeforeCut() {
  const affectedTests = require('../src/tools/dep-tools/affected-tests');
  const rows = [
    { file: '/r/tests/z_far.py', distance: 3, source: 'graph' },
    { file: '/r/tests/b_near.py', distance: 1, source: 'graph' },
    { file: '/r/tests/conftest_row.py', distance: 2, source: 'conftest' },
    { file: '/r/tests/a_near.py', distance: 1, source: 'graph' },
  ];
  const container = { snapshot: { graph: { findAffectedTests: () => rows, getDependents: () => [], _displayPath: (p) => p } } };
  const out = affectedTests({ file: 'x.py', maxFiles: 2 }, container, '/r/x.py');
  assert.deepStrictEqual(out.affectedTests.map((t) => t.file), ['/r/tests/a_near.py', '/r/tests/b_near.py'], '截断必须保留距离最近的测试，同距离按路径');
  assert.strictEqual(out.orderedBy, 'distance,hubFanIn,file');
  assert.strictEqual(out.truncated, true);
  assert.strictEqual(out.affectedTestsCount, 4);
}

function testHubPathTestsRankBelowNarrowPathTests() {
  const affectedTests = require('../src/tools/dep-tools/affected-tests');
  const fanIn = { '/r/hub.py': 90, '/r/helper.py': 2 };
  const rows = [
    { file: '/r/tests/a_via_hub.py', distance: 2, via: ['/r/x.py', '/r/hub.py'] },
    { file: '/r/tests/z_via_helper.py', distance: 2, via: ['/r/x.py', '/r/helper.py'] },
    { file: '/r/tests/m_direct.py', distance: 1, via: ['/r/x.py'] },
  ];
  const getDependents = (file) => Array.from({ length: fanIn[file] || 0 }, (_, i) => `d${i}`);
  const container = { snapshot: { graph: { findAffectedTests: () => rows, getDependents, _displayPath: (p) => p } } };
  const out = affectedTests({ file: 'x.py', maxFiles: 2 }, container, '/r/x.py');
  assert.deepStrictEqual(out.affectedTests.map((t) => t.file), ['/r/tests/m_direct.py', '/r/tests/z_via_helper.py'],
    '同距离时经窄中间文件的测试排在经枢纽文件的测试前，截断先丢枢纽路径');
}

function testAffectedTestsCommandKeepsToolLimitPastGenericNet() {
  const result = { ok: true, affectedTestsCount: 212, affectedTests: range(212), truncated: false };
  const out = JSON.parse(formatCliResult({ format: 'json', json: true, command: 'affected-tests' }, result));
  assert.strictEqual(out.affectedTests.length, 212, 'affected-tests 命令自己的上限是 500，通用 100 条兜底网不得先截断');
  assert.ok(!('elided' in out));
  const other = JSON.parse(formatCliResult({ format: 'json', json: true, command: 'dependents' }, { ok: true, dependents: range(212) }));
  assert.strictEqual(other.dependents.length, 100, '其他命令仍受通用兜底网约束');
  assert.strictEqual(other.truncated, true);
}

function testAiDigestMarksSampledLists() {
  const { formatAi } = require('../src/cli/formatters/human-formatters');
  const deps = range(50).map((i) => `src/d${i}.js`);
  const out = JSON.parse(formatAi('dependencies', { ok: true, file: 'x.js', dependenciesCount: 50, dependencies: deps }, { depth: 'detail' }));
  const shown = out.details.dependencies.length;
  assert.ok(shown < 50, '前提：AI 摘要会抽样');
  assert.strictEqual(out.truncated, true);
  assert.deepStrictEqual(out.elided, [{ path: 'details.dependencies', kind: 'array', shown, total: 50, reason: 'ai-digest' }]);

  const small = JSON.parse(formatAi('dependencies', { ok: true, file: 'x.js', dependenciesCount: 2, dependencies: deps.slice(0, 2) }, { depth: 'detail' }));
  assert.ok(!('elided' in small), '没抽样时不出现 elided');
}

const FIXTURE = [
  ['package.json', '{"name":"wb-p117","version":"1.0.0","private":true}\n'],
  ['src/lib.js', 'module.exports = { add: (a, b) => a + b };\n'],
  ['src/use.js', "const { add } = require('./lib');\nmodule.exports = () => add(1, 2);\n"],
  ...Array.from({ length: 7 }, (_, i) => [`test/lib${i}.test.js`, "const { add } = require('../src/lib');\nrequire('assert').strictEqual(add(1, 2), 3);\n"]),
];

async function testAuditFileCompactRecordsEmptiedLists() {
  const root = makeTempDir('wb-p117-');
  try {
    for (const [rel, body] of FIXTURE) {
      const abs = path.join(root, ...rel.split('/'));
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, body);
    }
    const out = await runCliInProcess(['audit-file', '--cwd', root, '--file', 'src/lib.js', '--compact', '--json', '--quiet']);
    assert.ok(out.affectedTests.affectedTestsCount > 0, '夹具里 lib.js 必须有受影响测试');
    assert.strictEqual(out.affectedTests.affectedTests.length, DEFAULTS.COMPACT_AFFECTED_TESTS_MAX, 'compact 保留列表头部，不留空列表');
    assert.strictEqual(out.affectedTests.truncated, true, 'compact 截短的列表必须标 truncated');
    assert.strictEqual(out.truncated, true);
    const entry = (out.elided || []).find((e) => e.path === 'affectedTests.affectedTests');
    assert.deepStrictEqual(entry, { path: 'affectedTests.affectedTests', kind: 'array', shown: DEFAULTS.COMPACT_AFFECTED_TESTS_MAX, total: out.affectedTests.affectedTestsCount, reason: 'compact' });
  } finally {
    cleanupTempDir(root);
  }
}

(async () => {
  testElideDeepReportsEveryCut();
  testJsonOutputSurfacesElision();
  testJsonOutputUntouchedWhenNothingCut();
  testExplicitMaxFilesBeatsSizeNet();
  testAffectedTestsSortedBeforeCut();
  testHubPathTestsRankBelowNarrowPathTests();
  testAffectedTestsCommandKeepsToolLimitPastGenericNet();
  testAiDigestMarksSampledLists();
  await testAuditFileCompactRecordsEmptiedLists();
  console.log('p1-17-explicit-truncation-test: OK');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
