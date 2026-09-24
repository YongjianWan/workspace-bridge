#!/usr/bin/env node
// @semantic
// @fast
/**
 * FileIndex 单趟发现契约——发现阶段必须是 O(树)，不是 O(patterns × 树)。
 *
 * 三条断言：
 * 1. readdir 调用次数与目录数同阶（杀变异：改回"每个扩展名 pattern 走一遍全树"必红）
 * 2. discovered 集合 parity：注册扩展全收（大小写不敏感），后缀陷阱不误收
 * 3. junction/符号链接环：不挂起、不重复、不出现别名路径
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

// readdir 计数必须在 require file-index 之前打桩：
// file-index 在模块加载时用 promisify(fs.readdir) 绑定，后打桩不生效
// （file-index-boundary-test.js 的权限测试就是这么变成空断言的，别再犯）。
let readdirCalls = 0;
const origReaddir = fs.readdir;
fs.readdir = function (...args) {
  readdirCalls += 1;
  return origReaddir.apply(this, args);
};

const { FileIndex } = require('../src/services/file-index');
const { WorkspaceCache } = require('../src/services/cache');

const ALL_EXTS = [
  '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs', '.mts', '.cts',
  '.py', '.java', '.kt', '.go', '.rs', '.vue',
  '.c', '.cpp', '.cc', '.h', '.hpp', '.svelte',
];

async function testSinglePassReaddirCount() {
  const root = makeTempDir('wb-1pass-count-');
  const DIRS = 10;
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 't' }));
  for (let i = 0; i < DIRS; i++) {
    const d = path.join(root, `d${i}`);
    fs.mkdirSync(d);
    fs.writeFileSync(path.join(d, 'a.js'), 'export const a = 1;\n');
  }

  try {
    const cache = new WorkspaceCache(root);
    const index = new FileIndex(root, cache);
    readdirCalls = 0;
    await index.build(30000, { watch: false });

    const dirsVisited = DIRS + 1; // 子目录 + 根
    assert(readdirCalls > 0, '打桩无效：readdir 计数为 0，断言没有意义');
    // 单趟 ≈ 每目录一次；按 pattern 循环的旧实现 = dirs × P（P≥8）≥ 88
    assert(
      readdirCalls <= dirsVisited * 2,
      `发现阶段应每目录只读一次，实际 readdir ${readdirCalls} 次 / ${dirsVisited} 个目录（O(patterns×树) 回潮）`
    );
    assert.strictEqual(cache.fileMetadata.size, DIRS, '全部文件应被索引');
  } finally {
    cleanupTempDir(root);
  }
}

async function testDiscoveredSetParity() {
  const root = makeTempDir('wb-1pass-parity-');
  // 构建标记把条件语言全部激活：js 族/vue/svelte 要 package.json，
  // java+kt 要 pom.xml，go 要 go.mod，rs 要 Cargo.toml，
  // c 族由 .c 文件自身（_hasCppFiles）、py 由 .py 文件自身触发。
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 't' }));
  fs.writeFileSync(path.join(root, 'pom.xml'), '<project/>\n');
  fs.writeFileSync(path.join(root, 'go.mod'), 'module t\n');
  fs.writeFileSync(path.join(root, 'Cargo.toml'), '[package]\n');

  const expected = [];
  ALL_EXTS.forEach((ext, i) => {
    const name = `m${i}${ext}`;
    fs.writeFileSync(path.join(root, name), 'export const x = 1;\n');
    expected.push(name);
  });
  // 大小写不敏感：扩展大写的文件同样属于注册语言（2026-08-17 的 ext 归一在
  // builder/file-index 查表侧已 lowercase，发现侧不允许漏掉它们）
  const UPPER = ['.ts', '.py', '.go'];
  for (const ext of UPPER) {
    const name = `big${ext.toUpperCase()}`;
    fs.writeFileSync(path.join(root, name), 'export const x = 1;\n');
    expected.push(name);
  }
  // 后缀陷阱：都不许进
  for (const decoy of ['notes.txt', 'Makefile', 'x.mts.bak', 'data.json', 'noext', 'm0.js.bak']) {
    fs.writeFileSync(path.join(root, decoy), 'decoy\n');
  }

  try {
    const cache = new WorkspaceCache(root);
    const index = new FileIndex(root, cache);
    await index.build(30000, { watch: false });

    // 比对源用 _indexedFiles（平台原生原始大小写）。不能用 cache key——
    // normalizePathKey 会小写化，大小写修正会被比没了。
    const got = index._indexedFiles.map((f) => path.relative(root, f).replace(/\\/g, '/')).sort();
    assert.deepStrictEqual(got, [...expected].sort(),
      `discovered 集合与期望不符（大写扩展/后缀陷阱）\n got: ${got.join(', ')}\n exp: ${[...expected].sort().join(', ')}`);
  } finally {
    cleanupTempDir(root);
  }
}

async function testJunctionCycleNoDup() {
  const root = makeTempDir('wb-1pass-junction-');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 't' }));
  const aDir = path.join(root, 'a');
  const bDir = path.join(aDir, 'b');
  fs.mkdirSync(bDir, { recursive: true });
  fs.writeFileSync(path.join(aDir, 'f1.js'), 'export const f1 = 1;\n');
  fs.writeFileSync(path.join(bDir, 'f2.js'), 'export const f2 = 2;\n');

  // 环：a/b/loop -> a（祖先）。Windows junction 与 POSIX 目录符号链接等价对待。
  const linkPath = path.join(bDir, 'loop');
  if (process.platform === 'win32') {
    execFileSync('cmd', ['/c', 'mklink', '/J', linkPath, aDir]);
  } else {
    fs.symlinkSync(aDir, linkPath, 'dir');
  }

  try {
    const cache = new WorkspaceCache(root);
    const index = new FileIndex(root, cache);
    await index.build(30000, { watch: false });

    const got = index._indexedFiles.map((f) => path.relative(root, f).replace(/\\/g, '/')).sort();
    assert.deepStrictEqual(got, ['a/b/f2.js', 'a/f1.js'],
      `环上文件应各索引一次且无别名路径，实际: ${JSON.stringify(got)}`);
  } finally {
    cleanupTempDir(root);
  }
}

async function testDepthTruncationWarns() {
  const root = makeTempDir('wb-1pass-depth-');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 't' }));
  // 13 层嵌套：目录深度 13 > FILE_INDEX_MAX_DEPTH(12)，必须显式警告（L1-4），
  // 不许静默丢子树。旧实现这里 `if (depth > maxDepth) continue` 是纯静默——
  // 本测试对旧实现必红（index.warnings 不存在）。
  let cur = root;
  for (let i = 1; i <= 13; i++) {
    cur = path.join(cur, `l${i}`);
    fs.mkdirSync(cur);
    if (i === 12) fs.writeFileSync(path.join(cur, 'shallow.js'), 'export const s = 1;\n');
    if (i === 13) fs.writeFileSync(path.join(cur, 'deep.js'), 'export const d = 1;\n');
  }

  try {
    const cache = new WorkspaceCache(root);
    const index = new FileIndex(root, cache);
    await index.build(30000, { watch: false });

    const got = index._indexedFiles.map((f) => path.relative(root, f).replace(/\\/g, '/'));
    assert(got.some((f) => f.endsWith('shallow.js')), `depth-12 文件应入索引，实际: ${got.join(', ')}`);
    assert(!got.some((f) => f.endsWith('deep.js')), `depth-13 文件应被截断，实际: ${got.join(', ')}`);

    const warn = (index.warnings || []).find((w) => w.type === 'depth-truncated');
    assert(warn, `深度截断必须进 warnings[]（L1-4），实际: ${JSON.stringify(index.warnings)}`);
    assert(warn.files >= 1 && /max depth 12/.test(warn.message),
      `depth-truncated 警告应带截断目录数与深度说明，实际: ${JSON.stringify(warn)}`);
  } finally {
    cleanupTempDir(root);
  }
}

async function main() {
  await testSinglePassReaddirCount();
  await testDiscoveredSetParity();
  await testJunctionCycleNoDup();
  await testDepthTruncationWarns();
}

main().catch((err) => {
  console.error('Test failed:', err.message);
  process.exit(1);
});
