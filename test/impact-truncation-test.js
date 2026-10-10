// @semantic
// T1.3: impact 输出的截断契约。
// 顺序契约：行保持 getImpactRadius 的 BFS 顺序原样穿过工具层（level 升序、
// dependents → dependencies → neighbors、发现顺序）——两轮 J1 回放证据表明
// 自定义相关性键（level/reason/目录）对 BFS 顺序不稳定占优（±1–4pp 互有胜负），
// 故不重排，只截断。本测试锁定"不重排"，防止未来静默改回。
// 截断契约：默认上限 DEFAULTS.IMPACT_RELEVANCE_LIMIT（15），--max-files 覆盖；
// impactCount 报截断前总数，truncated 如实标注。
const assert = require('assert');
const { DEFAULTS } = require('../src/config/constants');
const { dependencyGraph } = require('../src/tools/dep-tools');
const { makeMockSnapshot } = require('./test-helpers');

const INPUT = 'src/entity/User.java';

// 故意乱序：锁定工具层不改顺序
function bfsOrderedRows() {
  return [
    { file: '/repo/src/mapper/UserMapper.java', level: 1, reason: 'direct-import' },
    { file: '/repo/src/web/UserController.java', level: 2, reason: 'direct-import' },
    { file: '/repo/src/util/IdGen.java', level: 1, reason: 'direct-reference' },
    { file: '/repo/src/entity/UserVO.java', level: 1, reason: 'same-importer' },
  ];
}

function createMockContainer(rows) {
  const snapshot = makeMockSnapshot({
    root: '/repo',
    depGraphOverrides: {
      getImpactRadius: () => rows,
      getSymbolImpact: () => ({ mode: 'file-fallback', impactedFiles: [] }),
      _displayPath: (p) => p,
    },
  });
  return {
    ensureReady: async () => {},
    workspaceRoot: '/repo',
    snapshot,
  };
}

async function testOrderPreserved() {
  const rows = bfsOrderedRows();
  const container = createMockContainer(rows);
  const result = await dependencyGraph({ operation: 'impact', file: INPUT }, container);
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(
    result.impact.map((r) => r.file),
    rows.map((r) => r.file),
    '工具层必须保持 BFS 顺序，不得重排',
  );
  assert.strictEqual(result.truncated, false);
}

async function testDefaultTruncationToRelevanceLimit() {
  const rows = Array.from({ length: DEFAULTS.IMPACT_RELEVANCE_LIMIT + 5 }, (_, i) => ({
    file: `/repo/src/m/F${String(i).padStart(2, '0')}.java`, level: 1, reason: 'direct-import',
  }));
  const container = createMockContainer(rows);
  const result = await dependencyGraph({ operation: 'impact', file: INPUT }, container);
  assert.strictEqual(result.impact.length, DEFAULTS.IMPACT_RELEVANCE_LIMIT, '默认截到相关性上限');
  assert.strictEqual(result.impactCount, DEFAULTS.IMPACT_RELEVANCE_LIMIT + 5, 'impactCount 报截断前总数');
  assert.strictEqual(result.truncated, true);
  assert.deepStrictEqual(result.impact.map((r) => r.file), rows.slice(0, DEFAULTS.IMPACT_RELEVANCE_LIMIT).map((r) => r.file), '截断保留前部');
}

async function testMaxFilesOverridesRelevanceLimit() {
  const container = createMockContainer(bfsOrderedRows());
  const result = await dependencyGraph({ operation: 'impact', file: INPUT, maxFiles: 3 }, container);
  assert.strictEqual(result.impact.length, 3, '--max-files 覆盖默认上限');
  assert.strictEqual(result.truncated, true);
  assert.strictEqual(result.impact[0].file, '/repo/src/mapper/UserMapper.java', '截断保留列表头部');
}

async function testSmallResultNotTruncated() {
  const container = createMockContainer(bfsOrderedRows().slice(0, 2));
  const result = await dependencyGraph({ operation: 'impact', file: INPUT }, container);
  assert.strictEqual(result.impact.length, 2);
  assert.strictEqual(result.truncated, false);
}

async function testTruncationDeterministic() {
  const container = createMockContainer(bfsOrderedRows());
  const a = await dependencyGraph({ operation: 'impact', file: INPUT }, container);
  const b = await dependencyGraph({ operation: 'impact', file: INPUT }, container);
  assert.deepStrictEqual(a.impact, b.impact, '相同输入两次调用输出必须一致');
}

const tests = [
  testOrderPreserved,
  testDefaultTruncationToRelevanceLimit,
  testMaxFilesOverridesRelevanceLimit,
  testSmallResultNotTruncated,
  testTruncationDeterministic,
];

(async () => {
  let failed = 0;
  for (const t of tests) {
    try {
      await t();
      console.log(`  OK ${t.name}`);
    } catch (err) {
      failed += 1;
      console.log(`  FAIL ${t.name}: ${err.message}`);
    }
  }
  console.log(`impact-truncation-test: ${tests.length - failed} ok, ${failed} fail`);
  process.exit(failed ? 1 : 0);
})();
