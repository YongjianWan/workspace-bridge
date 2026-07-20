#!/usr/bin/env node
// @semantic — spawn-ast venv-aware python 解析 + 环境级失败 memo 短路
// @slow — 与 spawn-ast-direct-test 一致：mock child_process，按 runner 约定归类 slow
// 1) 存在 .venv 时必须用 venv 的 python，而非平台硬编码 python/python3
// 2) 环境级失败（python 缺失 / parser 依赖缺失）memo 后同进程短路，不再逐文件白 spawn
// 3) 瞬时失败（脚本崩溃/超时/坏 JSON）不 memo，下个文件照常重试
const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

const originalSpawn = cp.spawn;
const originalExistsSync = fs.existsSync;

function createMockProcess() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.unref = () => {};
  proc.kill = () => {};
  return proc;
}

function setupModule() {
  delete require.cache[require.resolve('../src/services/dep-graph/parsers/spawn-ast')];
  return require('../src/services/dep-graph/parsers/spawn-ast');
}

function okSpawn(capture) {
  cp.spawn = (cmd) => {
    if (capture) {
      capture.cmd = cmd;
      capture.count = (capture.count || 0) + 1;
    }
    const proc = createMockProcess();
    setImmediate(() => {
      proc.stdout.emit('data', JSON.stringify({ imports: [], exports: [] }));
      proc.emit('close', 0);
    });
    return proc;
  };
}

async function testVenvPythonPreferred() {
  const capture = {};
  fs.existsSync = (p) => String(p).includes('.venv') || String(p).includes('dummy.py');
  okSpawn(capture);
  const { spawnPythonASTParser } = setupModule();
  const result = await spawnPythonASTParser('dummy.py', 'content', 5000, '/repo');
  assert.deepStrictEqual(result, { imports: [], exports: [] });
  const expected = path.join('/repo', '.venv', 'Scripts', 'python.exe');
  assert.strictEqual(capture.cmd, expected, `should prefer venv python, got ${capture.cmd}`);
}

async function testPlatformDefaultPreserved() {
  const capture = {};
  fs.existsSync = (p) => String(p).includes('dummy.py');
  okSpawn(capture);
  const { spawnPythonASTParser } = setupModule();
  await spawnPythonASTParser('dummy.py', 'content', 5000, '/repo');
  const expected = process.platform === 'win32' ? 'python' : 'python3';
  assert.strictEqual(capture.cmd, expected, `no venv → keep platform default, got ${capture.cmd}`);
}

async function testSpawnErrorMemoizedAndShortCircuits() {
  const capture = {};
  fs.existsSync = () => true;
  cp.spawn = () => {
    capture.count = (capture.count || 0) + 1;
    const proc = createMockProcess();
    setImmediate(() => proc.emit('error', new Error('spawn python ENOENT')));
    return proc;
  };
  const mod = setupModule();
  const first = await mod.spawnPythonASTParser('dummy.py', 'content', 5000);
  assert.strictEqual(first, null);
  assert.strictEqual(mod.getParserEnvFailure('dummy.py'), 'python-missing');
  const second = await mod.spawnPythonASTParser('dummy.py', 'content', 5000);
  assert.strictEqual(second, null);
  assert.strictEqual(capture.count, 1, 'second call must short-circuit without spawning');
}

async function testDependencyMissingMemoized() {
  const capture = {};
  fs.existsSync = () => true;
  cp.spawn = () => {
    capture.count = (capture.count || 0) + 1;
    const proc = createMockProcess();
    setImmediate(() => {
      proc.stderr.emit('data', "ModuleNotFoundError: No module named 'javalang'");
      proc.emit('close', 1);
    });
    return proc;
  };
  const mod = setupModule();
  const first = await mod.spawnPythonASTParser('dummy.py', 'content', 5000);
  assert.strictEqual(first, null);
  assert.strictEqual(mod.getParserEnvFailure('dummy.py'), 'dependency-missing');
  await mod.spawnPythonASTParser('dummy.py', 'content', 5000);
  assert.strictEqual(capture.count, 1, 'dependency-missing must short-circuit subsequent calls');
}

async function testTransientFailureNotMemoized() {
  const capture = {};
  fs.existsSync = () => true;
  cp.spawn = () => {
    capture.count = (capture.count || 0) + 1;
    const proc = createMockProcess();
    setImmediate(() => {
      proc.stderr.emit('data', 'SyntaxError: unexpected token in input');
      proc.emit('close', 1);
    });
    return proc;
  };
  const mod = setupModule();
  await mod.spawnPythonASTParser('dummy.py', 'content', 5000);
  assert.strictEqual(mod.getParserEnvFailure('dummy.py'), undefined, 'script-level crash must not be memoized');
  await mod.spawnPythonASTParser('dummy.py', 'content', 5000);
  assert.strictEqual(capture.count, 2, 'transient failure should retry on next file');
}

async function main() {
  try {
    await testVenvPythonPreferred();
    await testPlatformDefaultPreserved();
    await testSpawnErrorMemoizedAndShortCircuits();
    await testDependencyMissingMemoized();
    await testTransientFailureNotMemoized();
    console.log('spawn-ast-env-test: all assertions passed');
  } finally {
    cp.spawn = originalSpawn;
    fs.existsSync = originalExistsSync;
    delete require.cache[require.resolve('../src/services/dep-graph/parsers/spawn-ast')];
  }
}

main().catch((err) => {
  cp.spawn = originalSpawn;
  fs.existsSync = originalExistsSync;
  console.error('Test failed:', err);
  process.exit(1);
});
