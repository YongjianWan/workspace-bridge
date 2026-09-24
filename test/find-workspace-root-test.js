// @semantic
// findWorkspaceRoot 定根语义（L2-23）：攀爬最多到自己仓库的 git 根，仓外不爬。
//
// 契约：
//   1. 环境噪音不信任——无标记目录之上恰好带标记的祖先（家目录 package.json
//      形状）不得把工作区吞成巨型根；给什么目录就认什么目录。
//   2. git 仓内子目录照旧上爬——仓库根是项目边界，`.git` 本身在标记清单里，
//      攀到 git 根必然命中。
//   3. start 自带标记照旧胜出（含 findNestedWorkspaceRoot 子工作区挑战者语义）。
//   4. 仓外非 git 项目：只认 start 自身（及其内部子工作区），不向上爬——
//      这是 2026-09-24 拍板的方案②语义，与旧行为（上爬命中 myapp/package.json）
//      刻意不同。
//   5. 入口是文件路径时按其所在目录定根（回归锁）。
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { findWorkspaceRoot, normalizePath } = require('../src/utils/path');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

function writeFixture(root, files, dirs) {
  for (const rel of dirs || []) {
    fs.mkdirSync(path.join(root, ...rel.split('/')), { recursive: true });
  }
  for (const [rel, body] of files) {
    const abs = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
}

const DIRS = [
  'ambient/scratch',
  'repo/.git',
  'repo/sub',
  'plainmod/myapp/sub',
  'nested/hub/pkg',
  'markroot',
];
const FILES = [
  ['ambient/package.json', '{}\n'], // 环境噪音：家目录 package.json 形状
  ['ambient/scratch/note.txt', 'x\n'],
  ['repo/package.json', '{}\n'],
  ['repo/sub/deep.txt', 'x\n'],
  ['repo/sub/deep.js', 'x\n'],
  ['plainmod/myapp/package.json', '{}\n'],
  ['plainmod/myapp/sub/x.txt', 'x\n'],
  ['nested/hub/pkg/package.json', '{}\n'],
  ['markroot/requirements.txt', 'x\n'],
];

function testAmbientNoiseNotTrusted(root) {
  // 核心 bug 形状（L2-23 病灶）：scratch 无标记，ambient 层带环境标记。
  // 旧实现上爬命中 ambient/package.json → 根=ambient；新语义必须认 scratch 自己。
  const got = findWorkspaceRoot(path.join(root, 'ambient', 'scratch'));
  assert.strictEqual(
    got,
    normalizePath(path.join(root, 'ambient', 'scratch')),
    `环境噪音祖先不得成为工作区根，实际: ${got}`
  );
}

function testGitSubdirStillClimbs(root) {
  // 回归锁：git 仓内子目录照旧定根到仓库根（`.git` 是边界也是标记）。
  const got = findWorkspaceRoot(path.join(root, 'repo', 'sub'));
  assert.strictEqual(got, normalizePath(path.join(root, 'repo')), `git 仓内子目录应上爬到仓根，实际: ${got}`);
}

function testStartMarkerWins(root) {
  // 回归锁：start 自带标记定根自身。
  const got = findWorkspaceRoot(path.join(root, 'markroot'));
  assert.strictEqual(got, normalizePath(path.join(root, 'markroot')), `start 自带标记应定根自身，实际: ${got}`);
}

function testNoGitNoClimb(root) {
  // 方案②拍板语义：仓外非 git 项目不向上爬——myapp/sub 的根就是 myapp/sub，
  // 不是 myapp（旧语义），更不是任何更高祖先。
  const got = findWorkspaceRoot(path.join(root, 'plainmod', 'myapp', 'sub'));
  assert.strictEqual(
    got,
    normalizePath(path.join(root, 'plainmod', 'myapp', 'sub')),
    `仓外无标记目录给什么认什么（方案②），实际: ${got}`
  );
}

function testNestedWorkspaceChallenge(root) {
  // findNestedWorkspaceRoot 挑战者语义保留：hub 无标记、hub/pkg 有 package.json。
  const got = findWorkspaceRoot(path.join(root, 'nested', 'hub'));
  assert.strictEqual(got, normalizePath(path.join(root, 'nested', 'hub', 'pkg')), `子工作区应胜出，实际: ${got}`);
}

function testFilePathStartsAtItsDir(root) {
  // 回归锁：文件路径入口按所在目录定根（repo/sub/deep.js → repo）。
  const got = findWorkspaceRoot(path.join(root, 'repo', 'sub', 'deep.js'));
  assert.strictEqual(got, normalizePath(path.join(root, 'repo')), `文件入口应按所在目录定根，实际: ${got}`);
}

async function main() {
  const root = makeTempDir('wb-findroot-');
  try {
    writeFixture(root, FILES, DIRS);
    testAmbientNoiseNotTrusted(root);
    testGitSubdirStillClimbs(root);
    testStartMarkerWins(root);
    testNoGitNoClimb(root);
    testNestedWorkspaceChallenge(root);
    testFilePathStartsAtItsDir(root);
    console.log('find-workspace-root-test: all passed');
  } finally {
    cleanupTempDir(root);
  }
}

main().catch((err) => {
  console.error('Test failed:', err.message);
  process.exit(1);
});
