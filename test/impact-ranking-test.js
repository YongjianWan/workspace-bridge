// @semantic
// T1.3: impact 输出的相关性排序与截断。
// 排序键：level 升序 → reason 优先级（direct-import > direct-reference > same-importer
// > implicit-same-package > transitive-dependency > transitive-reference > implicit-conftest
// > 未知 reason 垫后）→ 与输入同目录优先 → 路径字母序（确定性）。
// 截断：默认上限 DEFAULTS.IMPACT_RELEVANCE_LIMIT（15），--max-files 覆盖；
// impactCount 仍报截断前总数，truncated 如实标注。
const assert = require('assert');
const path = require('path');
const { DEFAULTS } = require('../src/config/constants');
const { dependencyGraph } = require('../src/tools/dep-tools');
const { makeMockSnapshot } = require('./test-helpers');

const INPUT = 'src/entity/User.java';

// 故意乱序给出，覆盖全部 reason 类和 level 1/2
function unsortedRows() {
  return [
    { file: '/repo/src/service/UserService.java', level: 2, reason: 'transitive-dependency' },
    { file: '/repo/src/conftest.py', level: 1, reason: 'implicit-conftest' },
    { file: '/repo/src/entity/UserVO.java', level: 1, reason: 'same-importer' },
    { file: '/repo/src/util/IdGen.java', level: 1, reason: 'direct-reference' },
    { file: '/repo/src/entity/BaseEntity.java', level: 1, reason: 'implicit-same-package' },
    { file: '/repo/src/mapper/UserMapper.java', level: 1, reason: 'direct-import' },
    { file: '/repo/src/mapper/SysDictMapper.java', level: 1, reason: 'transitive-dependency' },
    { file: '/repo/src/vo/ExtVO.java', level: 1, reason: 'same-importer' },
    { file: '/repo/src/entity/UserAo.java', level: 1, reason: 'same-importer' },
    { file: '/repo/src/web/UserController.java', level: 2, reason: 'direct-import' },
    { file: '/repo/src/legacy/Legacy.java', level: 1, reason: 'mystery-reason' },
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

async function testRankingOrder() {
  const container = createMockContainer(unsortedRows());
  const result = await dependencyGraph({ operation: 'impact', file: INPUT }, container);
  assert.strictEqual(result.ok, true);
  const names = result.impact.map((r) => r.file);
  assert.deepStrictEqual(names, [
    // level 1，按 reason 优先级；same-importer 组内同目录（entity/）优先、路径字母序
    '/repo/src/mapper/UserMapper.java',       // direct-import
    '/repo/src/util/IdGen.java',              // direct-reference
    '/repo/src/entity/UserAo.java',           // same-importer，同目录
    '/repo/src/entity/UserVO.java',           // same-importer，同目录
    '/repo/src/vo/ExtVO.java',                // same-importer，异目录
    '/repo/src/mapper/SysDictMapper.java',    // transitive-dependency
    '/repo/src/entity/BaseEntity.java',       // implicit-same-package（弱隐式边，排在传递边后）
    '/repo/src/conftest.py',                  // implicit-conftest
    '/repo/src/legacy/Legacy.java',           // 未知 reason 垫后
    // level 2 全部排在 level 1 之后，组内同样按 reason 优先级
    '/repo/src/web/UserController.java',      // direct-import
    '/repo/src/service/UserService.java',     // transitive-dependency
  ], `排序不符合预期: ${JSON.stringify(names)}`);
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
  // 截断发生在排序之后：同键时路径字母序的前 15 个留下
  assert.deepStrictEqual(result.impact.map((r) => r.file).slice(0, 3), rows.slice(0, 3).map((r) => r.file));
}

async function testMaxFilesOverridesRelevanceLimit() {
  const rows = unsortedRows();
  const container = createMockContainer(rows);
  const result = await dependencyGraph({ operation: 'impact', file: INPUT, maxFiles: 3 }, container);
  assert.strictEqual(result.impact.length, 3, '--max-files 覆盖默认上限');
  assert.strictEqual(result.truncated, true);
  assert.strictEqual(result.impact[0].file, '/repo/src/mapper/UserMapper.java', '截断保留排序后的头部');
}

async function testSmallResultNotTruncated() {
  const rows = unsortedRows().filter((r) => [
    '/repo/src/service/UserService.java',
    '/repo/src/mapper/UserMapper.java',
    '/repo/src/entity/UserVO.java',
    '/repo/src/entity/BaseEntity.java',
  ].includes(r.file));
  const container = createMockContainer(rows);
  const result = await dependencyGraph({ operation: 'impact', file: INPUT }, container);
  assert.strictEqual(result.impact.length, 4);
  assert.strictEqual(result.truncated, false);
  assert.deepStrictEqual(result.impact.map((r) => r.file), [
    '/repo/src/mapper/UserMapper.java',  // level 1，direct-import
    '/repo/src/entity/UserVO.java',      // level 1，same-importer
    '/repo/src/entity/BaseEntity.java',  // level 1，implicit-same-package
    '/repo/src/service/UserService.java',// level 2 垫后
  ], '≤上限 时也按相关性排序');
}

async function testRankingDeterministic() {
  const container = createMockContainer(unsortedRows());
  const a = await dependencyGraph({ operation: 'impact', file: INPUT }, container);
  const b = await dependencyGraph({ operation: 'impact', file: INPUT }, container);
  assert.deepStrictEqual(a.impact, b.impact, '相同输入两次调用顺序必须一致');
}

const tests = [
  testRankingOrder,
  testDefaultTruncationToRelevanceLimit,
  testMaxFilesOverridesRelevanceLimit,
  testSmallResultNotTruncated,
  testRankingDeterministic,
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
  console.log(`impact-ranking-test: ${tests.length - failed} ok, ${failed} fail`);
  process.exit(failed ? 1 : 0);
})();
