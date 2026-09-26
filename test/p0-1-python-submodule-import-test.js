// @semantic
// P0-1（审查报告 §4）：`from . import mod` / `from pkg import mod` 必须连到
// pkg/mod.py，而不是 pkg/__init__.py。
//
// 语义依据（Python 运行时）：`from X import a` 先取 X 的属性，取不到才导入
// 子模块 X/a —— 静态分析取不到「属性」这一层，但能确定性地判断
// `X/a.py` / `X/a/__init__.py` 是否存在。文件存在 = 子模块，连子模块；
// 不存在 = 符号（定义在 __init__ 里），维持旧行为连 __init__.py。
// 这不是名字猜测，是文件系统事实（同 tier1 path-existence 档）。
//
// 刻意保留的旧行为（防止修过头）：
//   - `import a.b.c`（无 from-名）仍走 plain candidates；
//   - `from X import *`（wildcard，无 from-名）仍连 X/__init__.py；
//   - `from X import fn`（fn 只定义在 __init__、无 X/fn.py）仍连 __init__.py；
//   - X/ 是目录但不构成模块（无 X.py 也无 X/__init__.py，如纯 namespace
//     子目录）时，仍回落到包自身的 __init__.py，不凭空造边。
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  tryPythonRelative,
  tryPythonAbsolute,
} = require('../src/services/dep-graph/resolvers/python');
const { cachedExistsSync } = require('../src/services/dep-graph/resolvers');
const { ServiceContainer } = require('../src/services/container');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

const FIXTURE = [
  ['requirements.txt', ''],
  ['pkg/__init__.py', 'def helper():\n    return 2\n'],
  ['pkg/target.py', 'def f():\n    return 1\n'],
  ['pkg/rel.py', 'from . import target\n'],
  ['pkg/absolute.py', 'from pkg import target\n'],
  ['pkg/symbolic.py', 'from pkg import helper\n'],
  ['pkg/starred.py', 'from pkg import *\n'],
  ['pkg/plainimport.py', 'import pkg.target\n'],
  // 纯 namespace 子目录：有内容文件但既无 extras.py 也无 extras/__init__.py
  ['pkg/extras/data.py', 'X = 1\n'],
];

function writeFixture(root) {
  for (const [rel, body] of FIXTURE) {
    const abs = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
}

function unitCtx(root, imported) {
  return { root, cachedExistsSync, imported };
}

function testResolverLevel(root) {
  const fromFile = path.join(root, 'pkg', 'rel.py');
  const init = path.join(root, 'pkg', '__init__.py');
  const target = path.join(root, 'pkg', 'target.py');

  // 1. `from . import target` — 相对导入的子模块压过 __init__.py
  assert.strictEqual(
    tryPythonRelative('.', fromFile, unitCtx(root, ['target'])),
    target,
    '相对 `from . import target` 必须解析到 pkg/target.py'
  );

  // 2. `from pkg import target` — 绝对导入的子模块压过 __init__.py
  assert.strictEqual(
    tryPythonAbsolute('pkg', fromFile, unitCtx(root, ['target'])),
    target,
    '绝对 `from pkg import target` 必须解析到 pkg/target.py'
  );

  // 3. 符号回退：`from pkg import helper` 无 pkg/helper.py → 仍是 __init__.py
  assert.strictEqual(
    tryPythonAbsolute('pkg', fromFile, unitCtx(root, ['helper'])),
    init,
    '包内符号（无对应子模块文件）必须维持连 __init__.py 的旧行为'
  );
  assert.strictEqual(
    tryPythonRelative('.', fromFile, unitCtx(root, ['helper'])),
    init,
    '相对导入的包内符号同样维持连 __init__.py'
  );

  // 4. wildcard：`from pkg import *` 无 from-名 → 仍连 __init__.py
  assert.strictEqual(
    tryPythonAbsolute('pkg', fromFile, unitCtx(root, [])),
    init,
    'wildcard/无 from-名 必须维持连 __init__.py'
  );

  // 5. `import pkg.target`（无 from-名）行为不变 → pkg/target.py
  assert.strictEqual(
    tryPythonAbsolute('pkg.target', fromFile, unitCtx(root, [])),
    target,
    'import a.b.c 的 plain candidates 行为必须不变'
  );

  // 6. 非模块目录：`from pkg import extras` — extras/ 无 .py 无 __init__.py，
  //    不许凭空造边，回落到包 __init__.py（与 L2-17 namespace 既有契约一致）
  assert.strictEqual(
    tryPythonAbsolute('pkg', fromFile, unitCtx(root, ['extras'])),
    init,
    '非模块目录的 from-名必须回落到 __init__.py，不得凭空造边'
  );
}

async function testGraphLevel(root) {
  const cacheDir = path.join(root, '.cache');
  const container = new ServiceContainer({ quiet: true, cacheDir });
  await container.initialize(root, 60000, { watch: false });
  try {
    const dg = container._depGraph;
    const norm = (p) => dg.normalizeFilePath(p);
    const key = (rel) => norm(path.join(root, ...rel.split('/')));
    const edgeTo = (fromRel, toRel) => {
      const info = dg.graph.get(key(fromRel));
      assert.ok(info, `图内应有 ${fromRel}`);
      return info.imports.includes(key(toRel));
    };

    // 用户消费层（审查报告的验收点）：dependents 靠的是这些边
    assert.ok(edgeTo('pkg/rel.py', 'pkg/target.py'), '`from . import target` 必须在图里连到 target.py');
    assert.ok(edgeTo('pkg/absolute.py', 'pkg/target.py'), '`from pkg import target` 必须在图里连到 target.py');
    assert.ok(
      !edgeTo('pkg/rel.py', 'pkg/__init__.py'),
      '子模块成立时不再连 __init__.py（报告语义：instead of，不是 additionally）'
    );
    assert.ok(
      !edgeTo('pkg/absolute.py', 'pkg/__init__.py'),
      '绝对导入的子模块边同样替换而非叠加 __init__.py'
    );

    // 旧行为保护区
    assert.ok(edgeTo('pkg/symbolic.py', 'pkg/__init__.py'), '包内符号 import 必须仍连 __init__.py');
    assert.ok(edgeTo('pkg/starred.py', 'pkg/__init__.py'), 'wildcard import 必须仍连 __init__.py');
    assert.ok(edgeTo('pkg/plainimport.py', 'pkg/target.py'), '`import pkg.target` 必须仍连 target.py');
  } finally {
    await container.shutdown();
  }
}

async function main() {
  const root = makeTempDir('wb-p01-submodule-');
  try {
    writeFixture(root);
    testResolverLevel(root);
    await testGraphLevel(root);
    console.log('p0-1-python-submodule-import-test: all passed');
  } finally {
    cleanupTempDir(root);
  }
}

main().catch((err) => {
  console.error('Test failed:', err.message);
  process.exit(1);
});
