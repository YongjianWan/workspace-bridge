// @semantic
// T1.2: impact 的方向扩展（dependencies / neighbors / all）、入口停止开关。
// 图结构（import 方向：x imports y 表示 x → y）：
//   a → b → c, d        e → a, d        index(入口，被 h 引用) → a, i        h → index
//   root(入口，无人引用) → a, k
const assert = require('assert');
const { normalizePathKey } = require('../src/utils/path');
const { createMockDepGraph } = require('./test-helpers');

function n(p) {
  return normalizePathKey(p);
}

const A = n('/repo/src/a.js');
const B = n('/repo/src/b.js');
const C = n('/repo/src/c.js');
const D = n('/repo/src/d.js');
const E = n('/repo/src/e.js');
const INDEX = n('/repo/src/index.js');
const I = n('/repo/src/i.js');
const H = n('/repo/src/h.js');
const ROOT = n('/repo/src/root.js');
const K = n('/repo/src/k.js');

function buildGraph() {
  const rec = (source, resolved) => [{ source, resolved, imported: [], usesAllExports: true }];
  return createMockDepGraph({
    root: '/repo',
    entryFiles: new Set([INDEX, ROOT]),
    schema: {
      [A]: { imports: [B], importRecords: rec('./b', B) },
      [B]: { imports: [C, D], importRecords: [...rec('./c', C), ...rec('./d', D)] },
      [C]: { imports: [] },
      [D]: { imports: [] },
      [E]: { imports: [A, D], importRecords: [...rec('./a', A), ...rec('./d', D)] },
      [INDEX]: { imports: [A, I], importRecords: [...rec('./a', A), ...rec('./i', I)] },
      [I]: { imports: [] },
      [H]: { imports: [INDEX], importRecords: rec('./index', INDEX) },
      [ROOT]: { imports: [A, K], importRecords: [...rec('./a', A), ...rec('./k', K)] },
      [K]: { imports: [] },
    },
  });
}

const byFile = (rows) => new Map(rows.map((r) => [r.file, r]));

function testDefaultUnchanged() {
  const g = buildGraph();
  const base = g.getImpactRadius(A, 5);
  const explicit = g.getImpactRadius(A, 5, { direction: 'dependents' });
  assert.deepStrictEqual(base, explicit, '不传 options 应与显式 dependents 逐格一致');

  const rows = byFile(base);
  assert(rows.has(E), 'e.js 应为 direct dependent');
  assert(rows.has(INDEX), '入口文件本身仍列出（停止的是扩散不是行）');
  assert(rows.has(H), '被引用的入口 index 不是终点：h.js 经 index 到达');
  assert.deepStrictEqual(rows.get(H).via, [A, INDEX]);
  assert(rows.has(ROOT), '无人引用的入口 root 本身仍列出');
  assert(!rows.has(B), 'dependents 方向不含 a 自己引用的 b');
  assert.strictEqual(rows.get(INDEX).reason, 'direct-import');
  assert.strictEqual(rows.get(INDEX).level, 1);
}

function testDependenciesDirection() {
  const g = buildGraph();
  const rows = byFile(g.getImpactRadius(A, 5, { direction: 'dependencies' }));

  assert(!rows.has(E) && !rows.has(INDEX), 'dependencies 方向不含 dependents');
  assert(rows.has(B), 'b 是 a 的直接引用');
  assert.strictEqual(rows.get(B).reason, 'direct-reference');
  assert.strictEqual(rows.get(B).level, 1);
  assert.deepStrictEqual(rows.get(B).via, [A]);
  assert(rows.has(C), 'c 经 b 到达');
  assert.strictEqual(rows.get(C).reason, 'transitive-reference');
  assert.strictEqual(rows.get(C).level, 2);
  assert.deepStrictEqual(rows.get(C).via, [A, B]);
  assert(rows.has(D), 'd 经 b 到达');
}

function testStopAtEntryFalse() {
  const g = buildGraph();
  const rows = byFile(g.getImpactRadius(A, 5, { stopAtEntry: false }));
  const h = rows.get(H);
  assert(h, 'stopAtEntry=false 时入口继续扩散，h.js 应出现');
  assert.strictEqual(h.level, 2);
  assert.deepStrictEqual(h.via, [A, INDEX]);
  assert(rows.has(ROOT), 'root 仍列出');
}

function testNeighborsDirection() {
  const g = buildGraph();
  const rows = byFile(g.getImpactRadius(A, 5, { direction: 'neighbors' }));
  assert.deepStrictEqual([...rows.keys()].sort(), [D, I].sort(), '同层邻居 d（经 e）、i（经被引用的入口 index）；无人引用的入口 root 的依赖 k 默认被跳过');
  const d = rows.get(D);
  assert.strictEqual(d.reason, 'same-importer');
  assert.deepStrictEqual(rows.get(I).via, [INDEX]);
  assert.strictEqual(d.level, 1);
  assert.deepStrictEqual(d.via, [E]);

  const rowsNoStop = byFile(g.getImpactRadius(A, 5, { direction: 'neighbors', stopAtEntry: false }));
  assert(rowsNoStop.has(K), 'stopAtEntry=false 时 root 的依赖 k 也算同层邻居');
  assert(rowsNoStop.has(I), 'i 仍在');
  assert(rowsNoStop.has(D), 'd 仍在');
}

function testAllDirection() {
  const g = buildGraph();
  const rows = byFile(g.getImpactRadius(A, 5, { direction: 'all' }));

  assert(rows.has(E) && rows.get(E).reason === 'direct-import', 'all 含 dependents');
  assert(rows.has(INDEX) && rows.get(INDEX).reason === 'direct-import', 'all 含入口行');
  assert(rows.has(B) && rows.get(B).reason === 'direct-reference', 'all 含 dependencies');
  assert(rows.has(C), 'all 经双向 BFS 到达 c');
  assert(rows.has(D), 'all 到达 d（b 的依赖 + e 的依赖，去重后一行）');
  assert(rows.has(H), 'all 经被引用的入口 index 到达 h');
  assert(rows.has(I), 'all 含被引用的入口 index 的依赖 i');
  assert(!rows.has(K), 'all 默认不展开无人引用的入口 root：k 不出现');
  assert(byFile(g.getImpactRadius(A, 5, { direction: 'all', stopAtEntry: false })).has(K), 'stopAtEntry=false 时 root 展开到 k');
}

function testSelfRowExcludedFromSameImporter() {
  // x↔y 循环边：y 是 x 的 importer，y 的依赖集含 x 自己。T1.3 修复前
  // _sameImporterRows 的 seen 不含 start，x 会作为自己的同层邻居漏进结果。
  const X = n('/repo/src/x.js');
  const Y = n('/repo/src/y.js');
  const Z = n('/repo/src/z.js');
  const rec = (source, resolved) => [{ source, resolved, imported: [], usesAllExports: true }];
  const g = createMockDepGraph({
    root: '/repo',
    entryFiles: new Set(),
    schema: {
      [X]: { imports: [Y], importRecords: rec('./y', Y) },
      [Y]: { imports: [X], importRecords: rec('./x', X) },
      [Z]: { imports: [X], importRecords: rec('./x', X) },
    },
  });
  const rowsAll = byFile(g.getImpactRadius(X, 5, { direction: 'all' }));
  assert(rowsAll.has(Y) && rowsAll.has(Z), 'x 的 dependents 仍正常列出');
  assert(!rowsAll.has(X), 'all 方向：同层邻居不得含 start 自己（循环边）');
  const rowsN = byFile(g.getImpactRadius(X, 5, { direction: 'neighbors' }));
  assert(!rowsN.has(X), 'neighbors 方向同样排除 start');
}

const tests = [
  testDefaultUnchanged,
  testDependenciesDirection,
  testStopAtEntryFalse,
  testNeighborsDirection,
  testAllDirection,
  testSelfRowExcludedFromSameImporter,
];

let failed = 0;
for (const t of tests) {
  try {
    t();
    console.log(`  OK ${t.name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL ${t.name}: ${err.message}`);
  }
}
console.log(`impact-direction-options-test: ${tests.length - failed} ok, ${failed} fail`);
process.exit(failed ? 1 : 0);
