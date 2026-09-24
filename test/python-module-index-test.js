// @semantic
// Python 裸名 import 的 module-index 解析（2026-09-24 实测：串围标仓 76 条 dropped 中
// 50 条样本里 32 条属"目标在工作区内但不在 root/backend/src/app 搜索根下"——skill 包
// `.agents/skills/*/scripts` 深处的模块被 `sys.path.insert + 裸名 import` 引用，
// tryPythonAbsolute 四个根全落空 → 记入 dropped）。
//
// 契约（全部基于确定性事实，不做名字猜测）：
//   1. same-dir 优先：fromFile 同目录下的同名模块胜出（入口脚本目录 = sys.path[0]，
//      实测 15/15 例同目录目标正确，含双胞胎消歧）。
//   2. 全工作区唯一后缀：`模块名.py` / `模块名/__init__.py` 在图内唯一时解析到它。
//   3. 歧义不猜：候选 >1 且无最近公共前缀唯一者时返回 null，由 droppedImports
//      如实记账（就近消歧契约见 python-module-index-nearest-test.js）。
//   4. 外部闸先行：manifest 声明/stdlib 的名字永不被本地同名文件捕获
//      （JS `parsers/shared.js` re-export 事故的 Python 版防线）。
//   5. 索引只含图内已发现文件——reference/generated 角色的文件不在图里，
//      就不可能被 import 捕获（串围标 `report` 撞名 liteparse 参考代码的实测案例）。
//
// 多语言等价性说明：本机制是 Python sys.path 文件导入语义专属。JS 裸名 = 包名
// （external gate 管辖，require('x') 永不指向树内任意 x.js）；JVM 全限定名走零表
// 规则；Go/Rust 走模块路径。语义不同构，按 T6 先例做 per-language 差异并在此记账。
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  tryPythonModuleIndex,
  buildPythonModuleIndex,
} = require('../src/services/dep-graph/resolvers/python');
const { resolveImport, cachedExistsSync } = require('../src/services/dep-graph/resolvers');
const { ServiceContainer } = require('../src/services/container');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

const FIXTURE = [
  ['requirements.txt', 'extpack\n'],
  ['prio_mod.py', 'ROOT_PRIO = 1\n'],
  ['tests/user_neutral.py', 'import helper_mod\n'],
  ['tests/user_unique.py', 'import only_mod\n'],
  ['tests/user_dotted.py', 'import subpack.inner\n'],
  ['tests/user_collision.py', 'import extpack\n'],
  ['tests/user_prio.py', 'import prio_mod\n'],
  ['skills/g2/scripts/helper_mod.py', 'G2 = 2\n'],
  ['skills/g2/scripts/twin_user.py', 'import helper_mod\n'],
  ['skills/g2/scripts/extpack.py', '# name-collision bait\n'],
  ['skills/g3/scripts/helper_mod.py', 'G3 = 3\n'],
  ['skills/g3/scripts/only_mod.py', 'ONLY = 1\n'],
  ['skills/g3/scripts/subpack/inner.py', 'INNER = 1\n'],
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

function testSameDirBeatsTwin(root, files) {
  const fromFile = path.join(root, 'skills', 'g2', 'scripts', 'twin_user.py');
  const target = path.join(root, 'skills', 'g2', 'scripts', 'helper_mod.py');
  // 不带 outMeta 直调不得抛错
  const resolved = tryPythonModuleIndex('helper_mod', fromFile, unitCtx(root, files));
  assert.strictEqual(resolved, target, `same-dir 必须胜出（g2 的 helper_mod），实际: ${resolved}`);
  const ctx = unitCtx(root, files);
  ctx.outMeta = {};
  tryPythonModuleIndex('helper_mod', fromFile, ctx);
  assert.strictEqual(ctx.outMeta.method, 'python-module-index', 'outMeta.method 契约');
  assert.strictEqual(ctx.outMeta.tier, 'tier2', '推断类解析 = tier2（同 symbol-table 档）');
}

function testUniqueSuffixResolves(root, files) {
  const fromFile = path.join(root, 'tests', 'user_unique.py');
  const target = path.join(root, 'skills', 'g3', 'scripts', 'only_mod.py');
  const resolved = tryPythonModuleIndex('only_mod', fromFile, unitCtx(root, files));
  assert.strictEqual(resolved, target, `图内唯一命中必须解析，实际: ${resolved}`);
}

function testDottedModuleResolves(root, files) {
  const fromFile = path.join(root, 'tests', 'user_dotted.py');
  const target = path.join(root, 'skills', 'g3', 'scripts', 'subpack', 'inner.py');
  const resolved = tryPythonModuleIndex('subpack.inner', fromFile, unitCtx(root, files));
  assert.strictEqual(resolved, target, `点号模块按路径后缀解析，实际: ${resolved}`);
}

function testAmbiguousStaysDropped(root, files) {
  const fromFile = path.join(root, 'tests', 'user_neutral.py');
  const resolved = tryPythonModuleIndex('helper_mod', fromFile, unitCtx(root, files));
  assert.strictEqual(resolved, null, `双胞胎歧义不许猜（中立位置无 same-dir），实际: ${resolved}`);
}

function testDeclaredExternalNeverCaptured(root, files) {
  // requirements.txt 声明 extpack；本地有 skills/g2/scripts/extpack.py 钓鱼文件。
  // 外部闸先行：声明归属是确定性事实，同名本地文件不得制造假边。
  const fromFile = path.join(root, 'tests', 'user_collision.py');
  const resolved = tryPythonModuleIndex('extpack', fromFile, unitCtx(root, files));
  assert.strictEqual(resolved, null, `manifest 声明的外部名不许被本地同名文件捕获，实际: ${resolved}`);
}

function testAbsoluteRootsBeatIndex(root, files) {
  // 根 prio_mod.py 与 skills 深处候选并存：tryPythonAbsolute 在链上先行，
  // module-index 只是兜底——策略链顺序契约。
  const fromFile = path.join(root, 'tests', 'user_prio.py');
  const outMeta = {};
  const resolved = resolveImport(fromFile, 'prio_mod', '.py', root, null, outMeta, null, {
    pythonModuleIndex: buildPythonModuleIndex(files),
  });
  assert.strictEqual(
    resolved,
    path.join(root, 'prio_mod.py'),
    `root 搜索根优先于 module-index，实际: ${resolved}`
  );
}

async function testGraphLevelWiring(root) {
  const cacheDir = path.join(root, '.cache');
  const container = new ServiceContainer({ quiet: true, cacheDir });
  await container.initialize(root, 60000, { watch: false });
  const dg = container._depGraph;

  const dropped = dg.getDroppedImports();
  assert.strictEqual(dropped.count, 1, `仅中立位双胞胎一条允许 dropped，实际 ${dropped.count}: ${JSON.stringify(dropped.samples)}`);
  assert.strictEqual(dropped.samples[0].specifier, 'helper_mod');

  const norm = (p) => dg.normalizeFilePath(p);
  const edgeTo = (fromRel, toRel) => {
    const info = dg.graph.get(norm(path.join(root, ...fromRel.split('/'))));
    assert.ok(info, `图内应有 ${fromRel}`);
    return info.imports.includes(norm(path.join(root, ...toRel.split('/'))));
  };
  assert.ok(edgeTo('skills/g2/scripts/twin_user.py', 'skills/g2/scripts/helper_mod.py'), 'same-dir 边必须在图里');
  assert.ok(edgeTo('tests/user_unique.py', 'skills/g3/scripts/only_mod.py'), '唯一后缀边必须在图里');
  assert.ok(edgeTo('tests/user_dotted.py', 'skills/g3/scripts/subpack/inner.py'), '点号模块边必须在图里');
  assert.ok(edgeTo('tests/user_prio.py', 'prio_mod.py'), 'root 优先边必须在图里');
  assert.ok(!edgeTo('tests/user_collision.py', 'skills/g2/scripts/extpack.py'), '声明外部名不得产生边');

  await container.shutdown();
}

async function main() {
  const root = makeTempDir('wb-py-modidx-');
  try {
    const files = writeFixture(root);
    testSameDirBeatsTwin(root, files);
    testUniqueSuffixResolves(root, files);
    testDottedModuleResolves(root, files);
    testAmbiguousStaysDropped(root, files);
    testDeclaredExternalNeverCaptured(root, files);
    testAbsoluteRootsBeatIndex(root, files);
    await testGraphLevelWiring(root);
    console.log('python-module-index-test: all passed');
  } finally {
    cleanupTempDir(root);
  }
}

main().catch((err) => {
  console.error('Test failed:', err.message);
  process.exit(1);
});
