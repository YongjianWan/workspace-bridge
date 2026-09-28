#!/usr/bin/env node
// @semantic
// @fast
/**
 * P1-4: node:sqlite 不可用（Node < 22.13）时，GraphDB 每次读写都静默
 * 退化成冷启动，缓存目录始终是空的。修复前没有任何提示；修复后应在
 * 第一次失败时向 stderr 打一条一次性警告，之后的调用不再重复。
 */
const assert = require('assert');
const { spawnSync } = require('child_process');
const path = require('path');

function runChild() {
  const graphDbPath = path.resolve(__dirname, '../src/services/graph-db');
  const script = `
    const Module = require('module');
    const path = require('path');
    const fs = require('fs');
    const os = require('os');

    // 模拟 Node < 22.13：node:sqlite 是未知内置模块
    const origLoad = Module._load;
    Module._load = function (request, ...rest) {
      if (request === 'node:sqlite') {
        const err = new Error("No such built-in module: node:sqlite");
        err.code = 'ERR_UNKNOWN_BUILTIN_MODULE';
        throw err;
      }
      return origLoad.call(this, request, ...rest);
    };

    const { GraphDB } = require(${JSON.stringify(graphDbPath)});
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-no-sqlite-'));
    const db = new GraphDB(path.join(tmpDir, 'cache.db'));

    // 读路径：静默 miss，不能崩
    const first = db.loadAll();
    // 第二次调用：警告不许重复
    const second = db.loadAll();

    console.log(JSON.stringify({ firstNull: first === null, secondNull: second === null }));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  `;

  return spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
}

function main() {
  const result = runChild();
  const stderr = result.stderr || '';

  assert.strictEqual(result.status, 0, `child should not crash, got status ${result.status}\nstderr: ${stderr}`);

  const payload = JSON.parse((result.stdout || '').trim());
  assert.strictEqual(payload.firstNull, true, 'read should degrade to a cache miss (null)');
  assert.strictEqual(payload.secondNull, true, 'second read should also degrade to a cache miss');

  assert(
    stderr.includes('node:sqlite'),
    `stderr should name node:sqlite, got:\n${stderr}`
  );
  assert(
    /22\.13/.test(stderr),
    `stderr should state the minimum Node version 22.13, got:\n${stderr}`
  );

  const occurrences = stderr.split(/node:sqlite/).length - 1;
  assert.strictEqual(occurrences, 1, `warning must fire exactly once, got ${occurrences}\nstderr: ${stderr}`);

  console.log('graph-db-sqlite-unavailable-test: PASS');
}

main();
