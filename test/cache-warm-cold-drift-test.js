#!/usr/bin/env node
// @semantic @slow — spawns the CLI for cold and warm runs on temp fixtures
// 契约：同一份磁盘内容，暖缓存跑出来的答案必须等于冷启动的答案。
//
// 两个场景都是"缓存里存的东西依赖了缓存 key 之外的输入"：
// 1. 新增文件：a.py 导入的 pkg.helper 在上一轮不存在。a.py 内容没变，
//    但它的 import 能解析到哪个文件取决于仓库里有哪些文件。
// 2. 原地改内容但保留 mtime 和大小：快照的新鲜度必须看内容，不能只看 stat。
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'cli.js');
const RUN_TIMEOUT_MS = 120000;

function runCli(args, cacheDir) {
  const run = spawnSync(process.execPath, [CLI, ...args, '--cache-dir', cacheDir, '--json', '--quiet'], {
    encoding: 'utf8',
    timeout: RUN_TIMEOUT_MS,
  });
  assert.strictEqual(run.status === 0 || run.status === 1, true, `cli ${args[0]} crashed (${run.status}): ${run.stderr}`);
  return JSON.parse(run.stdout);
}

function write(root, rel, content) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function impactNames(result) {
  return (result.impact || []).map((entry) => path.basename(entry.file)).sort();
}

function testNewImportTargetLinksUnchangedImporter(tmp) {
  const root = path.join(tmp, 'newfile');
  write(root, 'requirements.txt', 'requests\n');
  write(root, 'pkg/__init__.py', '');
  write(root, 'pkg/a.py', 'from pkg import helper\n\ndef run():\n    return helper.x\n');
  write(root, 'pkg/test_a.py', 'from pkg.a import run\n\ndef test_run():\n    assert run()\n');
  const warmCache = path.join(tmp, 'newfile-warm');
  runCli(['impact', '--cwd', root, '--file', 'pkg/a.py'], warmCache);

  write(root, 'pkg/helper.py', 'x = 1\n');
  const warm = runCli(['impact', '--cwd', root, '--file', 'pkg/helper.py'], warmCache);
  const cold = runCli(['impact', '--cwd', root, '--file', 'pkg/helper.py'], path.join(tmp, 'newfile-cold'));

  assert.deepStrictEqual(impactNames(cold), ['a.py', 'test_a.py'], 'cold baseline: helper.py is imported by a.py');
  assert.deepStrictEqual(
    impactNames(warm),
    impactNames(cold),
    'an importer whose content did not change must still link to a newly added target on a warm run'
  );
}

function testSameStatContentEditInvalidatesOverview(tmp) {
  const root = path.join(tmp, 'samestat');
  write(root, 'package.json', '{"name":"x","version":"1.0.0"}\n');
  write(root, 'a.js', "const b = require('./b');\nmodule.exports = { a: 1 };\n");
  write(root, 'b.js', "const a = 1;\nmodule.exports = { b: a };\n");
  write(root, 'index.js', "require('./a');\n");
  const cacheDir = path.join(tmp, 'samestat-cache');
  const before = runCli(['audit-overview', '--cwd', root], cacheDir);
  assert.strictEqual(before.cycles.cyclesCount, 0, 'fixture starts acyclic');

  // Same byte length, mtime restored: b.js now closes the a <-> b cycle.
  const bPath = path.join(root, 'b.js');
  const stat = fs.statSync(bPath);
  const original = fs.readFileSync(bPath, 'utf8');
  fs.writeFileSync(bPath, "require('./a');\nmodule.exports = {};\n".padEnd(original.length, ' '));
  fs.utimesSync(bPath, stat.atime, stat.mtime);
  assert.strictEqual(fs.statSync(bPath).size, stat.size, 'fixture keeps the size');

  const after = runCli(['audit-overview', '--cwd', root], cacheDir);
  assert.strictEqual(after.cycles.cyclesCount, 1, 'audit-overview must not replay a snapshot of content that changed');
}

function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-warm-cold-drift-'));
  try {
    testNewImportTargetLinksUnchangedImporter(tmp);
    testSameStatContentEditInvalidatesOverview(tmp);
    console.log('cache-warm-cold-drift-test: PASS');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main();
