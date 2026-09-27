#!/usr/bin/env node
// @semantic — importRecords 按语句去重，同 source 不同绑定不许合并
//
// 背景（typer 回归归因）：`from . import _click` 与 `from . import rich_utils`
// 共享 source "."，但 imported 不同、解析目标不同（P0-1 起解析依赖 imported）。
// 旧实现按 source 去重，模块级语句先到先得，函数内 `from . import rich_utils`
// 的记录在进 resolver 之前就被丢掉 —— typer/rich_utils.py 入边只剩测试文件
// 1 条，core.py/main.py/cli.py/_completion_classes.py 的绑定全部蒸发。
//
// 契约：
//   1. 同 source + 同 imported + 同 usesAllExports 的重复语句仍去重（6 处
//      相同的 `from . import rich_utils` 归并为 1 条记录、1 条边）；
//   2. 同 source 但 imported 不同的绑定各自保留，且各自解析到自己的目标。

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parsePython } = require('../src/services/dep-graph/parsers/python');
const { ServiceContainer } = require('../src/services/container');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

const CORE_SOURCE = [
  'from . import _click',
  '',
  '',
  'def render_error():',
  '    from . import rich_utils',
  '    return rich_utils.rich_format_error',
  '',
  '',
  'def warn():',
  '    from . import rich_utils',
  '    return rich_utils.rich_format_error',
  '',
].join('\n');

const FIXTURE = [
  ['requirements.txt', ''],
  ['pkg/__init__.py', ''],
  ['pkg/_click/__init__.py', ''],
  ['pkg/rich_utils.py', 'def rich_format_error(e):\n    return 1\n'],
  ['pkg/core.py', CORE_SOURCE],
];

function writeFixture(root) {
  for (const [rel, body] of FIXTURE) {
    const abs = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
}

async function testParserLevel() {
  const parsed = await parsePython(CORE_SOURCE, 'core.py');
  assert.ok(parsed, 'Python parser must be available');

  const bindings = parsed.importRecords
    .filter((r) => r.source === '.')
    .map((r) => (r.imported || []).join(','));

  assert.ok(
    bindings.includes('_click'),
    `from . import _click 记录必须保留，实际 bindings=${JSON.stringify(bindings)}`
  );
  assert.ok(
    bindings.includes('rich_utils'),
    `函数内 from . import rich_utils 记录必须保留，实际 bindings=${JSON.stringify(bindings)}`
  );

  const ruRecords = parsed.importRecords.filter((r) => (r.imported || []).includes('rich_utils'));
  assert.strictEqual(
    ruRecords.length,
    1,
    `两条相同的 from . import rich_utils 应去重为 1 条，实际 ${ruRecords.length} 条`
  );
}

async function testGraphLevel(root) {
  const cacheDir = path.join(root, '.cache');
  const container = new ServiceContainer({ quiet: true, cacheDir });
  await container.initialize(root, 60000, { watch: false });
  try {
    const dg = container._depGraph;
    const key = (rel) => dg.normalizeFilePath(path.join(root, ...rel.split('/')));
    const info = dg.graph.get(key('pkg/core.py'));
    assert.ok(info, '图内应有 pkg/core.py');

    assert.ok(
      info.imports.includes(key('pkg/_click/__init__.py')),
      'from . import _click 必须成边到 _click/__init__.py'
    );
    assert.ok(
      info.imports.includes(key('pkg/rich_utils.py')),
      '函数内 from . import rich_utils 必须成边到 rich_utils.py'
    );

    const ruInfo = dg.graph.get(key('pkg/rich_utils.py'));
    assert.ok(ruInfo, '图内应有 pkg/rich_utils.py');
    const dependents = dg.reverseGraph.get(key('pkg/rich_utils.py')) || [];
    assert.ok(
      dependents.includes(key('pkg/core.py')),
      `rich_utils.py 的入边必须含 core.py，实际=${JSON.stringify(dependents)}`
    );
  } finally {
    await container.shutdown();
  }
}

async function main() {
  await testParserLevel();
  const root = makeTempDir('wb-import-bindings-');
  try {
    writeFixture(root);
    await testGraphLevel(root);
    console.log('python-import-record-bindings-test: all passed');
  } finally {
    cleanupTempDir(root);
  }
}

main().catch((err) => {
  console.error('Test failed:', err.message);
  process.exit(1);
});
