// @semantic
// 孤儿列表输出的路径必须保留磁盘上的原始大小写。图键在 Windows 上是小写规范化的，
// 直接输出图键会让大小写敏感的消费方（agent 拿路径去 git、去 Linux 容器）找不到文件。
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ServiceContainer } = require('../src/services/container');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

(async () => {
  const root = makeTempDir('wb-p118-');
  try {
    fs.mkdirSync(path.join(root, 'Native'), { recursive: true });
    fs.writeFileSync(path.join(root, 'Native', 'Lonely_Utils.c'), 'int lonely(void) { return 0; }\n');
    const container = new ServiceContainer({ quiet: true, cacheDir: path.join(root, '.cache') });
    await container.initialize(root, 60000, { watch: false });
    try {
      const orphans = container._depGraph.findOrphanFiles();
      const all = orphans.all.map((p) => String(p).replace(/\\/g, '/'));
      assert.ok(all.includes('Native/Lonely_Utils.c'), `孤儿路径必须是原始大小写，实际 ${JSON.stringify(all)}`);
      assert.ok(orphans.modules.map((p) => String(p).replace(/\\/g, '/')).includes('Native/Lonely_Utils.c'));
    } finally {
      await container.shutdown();
    }
  } finally {
    cleanupTempDir(root);
  }
  console.log('p1-18-orphan-path-casing-test: OK');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
