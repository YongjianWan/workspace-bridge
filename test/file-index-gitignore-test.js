#!/usr/bin/env node
// @semantic
// @fast
/**
 * .gitignore 摄入契约：忽略/回含语义由 git 自己裁决（`check-ignore --stdin`
 * 批量过滤），不手写 .gitignore 解析器。fixture 复刻真实混合仓（串围标）的
 * `/data/* + !` 白名单形状；git 不可用时必须显式降级（warnings[]），禁止
 * 静默照单全收或静默丢弃（L1-4）。
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');
const { FileIndex } = require('../src/services/file-index');
const { WorkspaceCache } = require('../src/services/cache');

async function testGitignoreWhitelistRespected() {
  const root = makeTempDir('wb-gitignore-');
  execFileSync('git', ['init', '-q'], { cwd: root });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 't' }));
  // 串围标 .gitignore 的真实形状：data 默认全忽略，白名单目录回含
  fs.writeFileSync(
    path.join(root, '.gitignore'),
    '/data/*\n!/data/acceptance/\n!/data/acceptance/**\n'
  );
  fs.mkdirSync(path.join(root, 'data', 'acceptance'), { recursive: true });
  fs.writeFileSync(path.join(root, 'data', 'skipme.py'), 'x = 1\n');
  fs.writeFileSync(path.join(root, 'data', 'acceptance', 'keepme.py'), 'y = 2\n');
  fs.writeFileSync(path.join(root, 'main.py'), 'z = 3\n');

  try {
    const cache = new WorkspaceCache(root);
    const index = new FileIndex(root, cache);
    await index.build(30000, { watch: false });

    const got = index._indexedFiles.map((f) => path.relative(root, f).replace(/\\/g, '/')).sort();
    assert.deepStrictEqual(got, ['data/acceptance/keepme.py', 'main.py'],
      `gitignore 忽略与 ! 回含必须按 git 语义裁决，实际: ${got.join(', ')}`);
  } finally {
    cleanupTempDir(root);
  }
}

async function testGitUnavailableWarnsAndKeeps() {
  // 无 git 仓库但根有 .gitignore——check-ignore 不可用 → 显式降级：
  // 照常索引 + warnings[] 声明过滤未生效。旧实现对 .gitignore 全然无视
  // 且无任何信号，本测试对旧实现必红。
  const root = makeTempDir('wb-gitignore-nogit-');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 't' }));
  fs.writeFileSync(path.join(root, '.gitignore'), '*.py\n');
  fs.writeFileSync(path.join(root, 'main.py'), 'z = 3\n');

  try {
    const cache = new WorkspaceCache(root);
    const index = new FileIndex(root, cache);
    await index.build(30000, { watch: false });

    const got = index._indexedFiles.map((f) => path.relative(root, f).replace(/\\/g, '/')).sort();
    assert.deepStrictEqual(got, ['main.py'],
      `git 不可用时应照常索引（过滤显式降级），实际: ${got.join(', ')}`);
    const warn = (index.warnings || []).find((w) => w.type === 'gitignore-unavailable');
    assert(warn, `gitignore 过滤不可用必须进 warnings[]（L1-4），实际: ${JSON.stringify(index.warnings)}`);
  } finally {
    cleanupTempDir(root);
  }
}

async function testNoGitignoreNoWarning() {
  // 什么都没承诺（无 .git 无 .gitignore）→ 不许乱叫
  const root = makeTempDir('wb-gitignore-none-');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 't' }));
  fs.writeFileSync(path.join(root, 'main.py'), 'z = 3\n');

  try {
    const cache = new WorkspaceCache(root);
    const index = new FileIndex(root, cache);
    await index.build(30000, { watch: false });

    const got = index._indexedFiles.map((f) => path.relative(root, f).replace(/\\/g, '/')).sort();
    assert.deepStrictEqual(got, ['main.py'], `无 gitignore 时正常索引，实际: ${got.join(', ')}`);
    assert.strictEqual((index.warnings || []).length, 0,
      `无承诺时不应有警告，实际: ${JSON.stringify(index.warnings)}`);
  } finally {
    cleanupTempDir(root);
  }
}

async function main() {
  await testGitignoreWhitelistRespected();
  await testGitUnavailableWarnsAndKeeps();
  await testNoGitignoreNoWarning();
}

main().catch((err) => {
  console.error('Test failed:', err.message);
  process.exit(1);
});
