// @semantic
// Python module-index 多胞胎消歧：最近公共前缀唯一者胜出（串围标 dropped 残留
// 实测：af_client / model_call_audit / deepseek_client 各有两份拷贝，skill 的
// tests/ 经 conftest 注入自己 scripts/ 后裸名 import——静态解析的正确目标就是
// 与 fromFile 共享路径前缀最深的那一份）。
//
// 契约：
//   1. 候选 >1 时按「与 fromFile 的公共路径段数」取严格最深者，唯一时解析到它。
//   2. 平手不猜：最深者不唯一（含中立位 importer）返回 null，留在 droppedImports。
//   3. 就近消歧是弱推断：confidence 0.6，低于唯一命中的 0.8（tier 同为 tier2）——
//      运行时 sys.path 顺序若偏爱另一份拷贝，消费方能从置信度察觉。
//
// 多语言等价性说明：同 python-module-index-test.js——Python sys.path 文件导入
// 语义专属，其余语言的裸名各有外部闸/零表/模块路径规则，不共享此机制。
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  tryPythonModuleIndex,
  buildPythonModuleIndex,
} = require('../src/services/dep-graph/resolvers/python');
const { cachedExistsSync } = require('../src/services/dep-graph/resolvers');
const { ServiceContainer } = require('../src/services/container');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

// 工作区根标记（requirements.txt）：不能省。findWorkspaceRoot 对无标记目录
// 逐级向上爬，会把恰好带标记的巨型祖先（Desktop/主目录级）当成工作区，
// init 变成"索引半个硬盘"——2026-09-24 实测烧掉两小时才定位（AGENTS 陷阱表）。
const FIXTURE = [
  ['requirements.txt', '# workspace root marker only\n'],
  ['skills/g2/scripts/helper_mod.py', 'G2 = 2\n'],
  ['skills/g3/scripts/helper_mod.py', 'G3 = 3\n'],
  ['skills/g2/tests/near_user.py', 'import helper_mod\n'],
  ['skills/g3/tests/near_user.py', 'import helper_mod\n'],
  ['tests/neutral_user.py', 'import helper_mod\n'],
];

function writeFixture(root) {
  for (const [rel, body] of FIXTURE) {
    const abs = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  return FIXTURE.map(([rel]) => path.join(root, ...rel.split('/')));
}

function unitCtx(root, files) {
  return {
    root,
    cachedExistsSync,
    pythonModuleIndex: buildPythonModuleIndex(files),
    imported: [],
  };
}

function testNearestTwinResolves(root, files) {
  const fromFile = path.join(root, 'skills', 'g2', 'tests', 'near_user.py');
  const target = path.join(root, 'skills', 'g2', 'scripts', 'helper_mod.py');
  const resolved = tryPythonModuleIndex('helper_mod', fromFile, unitCtx(root, files));
  assert.strictEqual(resolved, target, `最近公共前缀最深的候选必须胜出（g2 自己的拷贝），实际: ${resolved}`);
  const ctx = unitCtx(root, files);
  ctx.outMeta = {};
  tryPythonModuleIndex('helper_mod', fromFile, ctx);
  assert.strictEqual(ctx.outMeta.method, 'python-module-index', 'outMeta.method 契约');
  assert.strictEqual(ctx.outMeta.tier, 'tier2', '推断类解析 = tier2');
  assert.strictEqual(ctx.outMeta.confidence, 0.6, '就近消歧弱于唯一命中，confidence 必须降档显式化');
}

function testNearestIsSymmetric(root, files) {
  // g3 侧对称命中，证明消歧看路径邻近而非候选/索引顺序（g2 在 fixture 里先出现）。
  const fromFile = path.join(root, 'skills', 'g3', 'tests', 'near_user.py');
  const target = path.join(root, 'skills', 'g3', 'scripts', 'helper_mod.py');
  const resolved = tryPythonModuleIndex('helper_mod', fromFile, unitCtx(root, files));
  assert.strictEqual(resolved, target, `g3 侧 importer 必须命中 g3 的拷贝，实际: ${resolved}`);
}

function testNeutralTieStaysDropped(root, files) {
  // 根 tests/ 的 importer 与两份拷贝共享前缀一样深——平手不猜。
  const fromFile = path.join(root, 'tests', 'neutral_user.py');
  const resolved = tryPythonModuleIndex('helper_mod', fromFile, unitCtx(root, files));
  assert.strictEqual(resolved, null, `平手歧义不许猜（中立位无 same-dir），实际: ${resolved}`);
}

async function testGraphNearestWiring(root) {
  const cacheDir = path.join(root, '.cache');
  const container = new ServiceContainer({ quiet: true, cacheDir });
  await container.initialize(root, 60000, { watch: false });
  const dg = container._depGraph;

  const dropped = dg.getDroppedImports();
  assert.strictEqual(dropped.count, 1, `仅中立位平手一条允许 dropped，实际 ${dropped.count}: ${JSON.stringify(dropped.samples)}`);
  assert.strictEqual(dropped.samples[0].specifier, 'helper_mod');
  assert.ok(
    String(dropped.samples[0].file).includes('neutral_user'),
    `dropped 应只剩中立位 importer，实际: ${dropped.samples[0].file}`
  );

  const norm = (p) => dg.normalizeFilePath(p);
  const edgeTo = (fromRel, toRel) => {
    const info = dg.graph.get(norm(path.join(root, ...fromRel.split('/'))));
    assert.ok(info, `图内应有 ${fromRel}`);
    return info.imports.includes(norm(path.join(root, ...toRel.split('/'))));
  };
  assert.ok(edgeTo('skills/g2/tests/near_user.py', 'skills/g2/scripts/helper_mod.py'), 'g2 就近消歧边必须在图里');
  assert.ok(edgeTo('skills/g3/tests/near_user.py', 'skills/g3/scripts/helper_mod.py'), 'g3 就近消歧边必须在图里');
  assert.ok(!edgeTo('tests/neutral_user.py', 'skills/g2/scripts/helper_mod.py'), '中立位不得产生边');
  assert.ok(!edgeTo('tests/neutral_user.py', 'skills/g3/scripts/helper_mod.py'), '中立位不得产生边');

  await container.shutdown();
}

async function main() {
  const root = makeTempDir('wb-py-near-');
  try {
    const files = writeFixture(root);
    testNearestTwinResolves(root, files);
    testNearestIsSymmetric(root, files);
    testNeutralTieStaysDropped(root, files);
    await testGraphNearestWiring(root);
    console.log('python-module-index-nearest-test: all passed');
  } finally {
    cleanupTempDir(root);
  }
}

main().catch((err) => {
  console.error('Test failed:', err.message);
  process.exit(1);
});
