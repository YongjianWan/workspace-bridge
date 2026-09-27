// @semantic
// C/C++ 两处图模型语义：
//   1. 源文件（.c/.cc/.cpp/.cxx）里的宏、struct、enum、typedef、class 只在本编译单元
//      可见，别的文件链接不到 → 不是导出（cJSON_Utils.c 里的 `#define true`）。
//      头文件里的同类声明是公开 API，照旧算导出。
//   2. 有同 stem 配对头（foo.c ↔ foo.h）的源文件不是孤儿：消费方 include 头文件，
//      实现文件本来就不会被 include。没有配对头的仍是孤儿。
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ServiceContainer } = require('../src/services/container');
const { parseCppAst } = require('../src/services/dep-graph/parsers/cpp-ast');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

const TU_LOCAL_SOURCE = [
  '#define _CRT_SECURE_NO_DEPRECATE',
  '#define true ((int)1)',
  'struct patch { int op; };',
  'enum patch_operation { ADD, REMOVE };',
  'typedef int handle_t;',
  'static int helper(void) { return 1; }',
  'int public_api(void) { return helper(); }',
  '',
].join('\n');

const LOCAL_NAMES = ['_CRT_SECURE_NO_DEPRECATE', 'true', 'patch', 'patch_operation', 'handle_t'];

async function assertSourceLinkage() {
  for (const file of ['lib.c', 'lib.cpp', 'lib.cc']) {
    const r = await parseCppAst(TU_LOCAL_SOURCE, file);
    assert.deepStrictEqual(r.exports, ['public_api'], `${file} 只应导出外部链接函数，实际 ${JSON.stringify(r.exports)}`);
    assert.ok(r.exportRecords.every((e) => e.name === 'public_api'), `${file} exportRecords 不得含编译单元局部声明`);
  }
  const header = await parseCppAst(TU_LOCAL_SOURCE, 'lib.h');
  for (const name of LOCAL_NAMES) {
    assert.ok(header.exports.includes(name), `头文件里的 ${name} 是公开 API，必须保留为导出`);
  }
}

const FIXTURE = [
  ['native/pair.h', 'int pair_sum(int a, int b);\n'],
  ['native/pair.c', '#include "pair.h"\n#define LOCAL_MAX 8\nint pair_sum(int a, int b) { return a + b; }\n'],
  ['native/lonely.c', 'int lonely(void) { return 0; }\n'],
];

async function assertPairedSourceNotOrphan() {
  const root = makeTempDir('wb-p112-');
  try {
    for (const [rel, body] of FIXTURE) {
      const abs = path.join(root, ...rel.split('/'));
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, body);
    }
    const container = new ServiceContainer({ quiet: true, cacheDir: path.join(root, '.cache') });
    await container.initialize(root, 60000, { watch: false });
    try {
      const orphans = container._depGraph.findOrphanFiles().all.map((p) => String(p).replace(/\\/g, '/'));
      assert.ok(!orphans.some((p) => p.endsWith('native/pair.c')), `有配对头的 pair.c 不应是孤儿，实际 ${JSON.stringify(orphans)}`);
      assert.ok(orphans.some((p) => p.endsWith('native/lonely.c')), `无配对头的 lonely.c 仍应是孤儿（防全部豁免），实际 ${JSON.stringify(orphans)}`);
    } finally {
      await container.shutdown?.();
    }
  } finally {
    cleanupTempDir(root);
  }
}

(async () => {
  await assertSourceLinkage();
  await assertPairedSourceNotOrphan();
  console.log('p1-12-c-linkage-pairing-test: OK');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
