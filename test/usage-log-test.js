#!/usr/bin/env node
// @fast
// @contract
/**
 * ROADMAP T2.0 本机使用日志契约：
 *   a. WB_USAGE_LOG 设置时，每次 CLI 运行追加一行 JSON，六个字段齐全，工作区路径不落明文；
 *   b. 未设置时不建文件、不写日志；
 *   c. `usage-log mark` 只改指定行，其余行字节不动；非法 marker 退出码 1；
 *   d. `usage-log` 命令自身运行也照常写使用日志（口径：每次运行都写）。
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { runCliRaw, makeTempDir, cleanupTempDir } = require('./test-helpers');

const LOG_FIELDS = ['time', 'command', 'workspaceHash', 'outputFiles', 'durationMs', 'exitCode'];

function envWith(logPath) {
  const env = { ...process.env };
  if (logPath) env.WB_USAGE_LOG = logPath;
  else delete env.WB_USAGE_LOG;
  return env;
}

function readLines(file) {
  return fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.length > 0);
}

function stripBOM(text) {
  return text && text.startsWith('\ufeff') ? text.slice(1) : text;
}

const fixDir = makeTempDir('wb-usage-fix-');
const logDir = makeTempDir('wb-usage-log-');
try {
  fs.writeFileSync(path.join(fixDir, 'a.js'), 'module.exports = 1;\n');

  // a. WB_USAGE_LOG 设置 → 恰好一行、字段齐全、哈希无明文、exitCode=0
  const logA = path.join(logDir, 'run.jsonl');
  const runA = runCliRaw(['workspace-info', '--cwd', fixDir, '--json', '--quiet'], { env: envWith(logA) });
  assert.strictEqual(runA.status, 0, runA.stderr);
  const linesA = readLines(logA);
  assert.strictEqual(linesA.length, 1, `expected exactly 1 usage line, got ${linesA.length}`);
  const entry = JSON.parse(linesA[0]);
  for (const field of LOG_FIELDS) {
    assert.ok(Object.prototype.hasOwnProperty.call(entry, field), `usage line missing field: ${field}`);
  }
  assert.match(entry.workspaceHash, /^[0-9a-f]{64}$/, 'workspaceHash must be 64-char hex');
  assert.ok(!linesA[0].includes(fixDir), 'workspace path must not appear in plaintext');
  assert.ok(!linesA[0].includes(fixDir.replace(/\\/g, '/')), 'workspace path must not appear in plaintext (posix spelling)');
  assert.strictEqual(entry.exitCode, 0);
  assert.ok(Number.isInteger(entry.durationMs) && entry.durationMs >= 0, `durationMs must be a non-negative integer, got ${entry.durationMs}`);
  assert.ok(Number.isInteger(entry.outputFiles) && entry.outputFiles >= 0, `outputFiles must be a non-negative integer, got ${entry.outputFiles}`);
  assert.strictEqual(entry.command, 'workspace-info');
  assert.ok(!Number.isNaN(Date.parse(entry.time)), `time must be ISO 8601 parseable, got ${entry.time}`);

  // b. 未设置 WB_USAGE_LOG → 文件不被创建
  const logB = path.join(logDir, 'never.jsonl');
  const runB = runCliRaw(['workspace-info', '--cwd', fixDir, '--json', '--quiet'], { env: envWith(null) });
  assert.strictEqual(runB.status, 0, runB.stderr);
  assert.ok(!fs.existsSync(logB), 'usage log must not be created when WB_USAGE_LOG is unset');

  // c. mark 改第 2 行、第 1 行字节不动；非法 marker 退出码 1
  const logC = path.join(logDir, 'mark.jsonl');
  const line1 = JSON.stringify({ time: '2026-10-08T00:00:00.000Z', command: 'impact', workspaceHash: 'a'.repeat(64), outputFiles: 3, durationMs: 12, exitCode: 0 });
  const line2 = JSON.stringify({ time: '2026-10-08T00:01:00.000Z', command: 'impact', workspaceHash: 'b'.repeat(64), outputFiles: 0, durationMs: 9, exitCode: 0 });
  fs.writeFileSync(logC, line1 + '\n' + line2 + '\n');

  const markRun = runCliRaw(['usage-log', 'mark', '--file', logC, '--line', '2', '--marker', 'missed', '--note', '漏了后端', '--json', '--quiet'], { env: envWith(null) });
  assert.strictEqual(markRun.status, 0, markRun.stderr);
  const markOut = JSON.parse(stripBOM(markRun.stdout));
  assert.strictEqual(markOut.ok, true);
  assert.strictEqual(markOut.line, 2);
  assert.strictEqual(markOut.marker, 'missed');
  assert.strictEqual(markOut.note, '漏了后端');

  const afterC = readLines(logC);
  assert.strictEqual(afterC.length, 2, 'mark must not add or drop lines');
  assert.strictEqual(afterC[0], line1, 'line 1 must stay byte-identical');
  const marked = JSON.parse(afterC[1]);
  assert.strictEqual(marked.marker, 'missed');
  assert.strictEqual(marked.note, '漏了后端');
  assert.strictEqual(marked.command, 'impact', 'mark must keep the original fields');

  const badRun = runCliRaw(['usage-log', 'mark', '--file', logC, '--line', '2', '--marker', 'nope', '--json', '--quiet'], { env: envWith(null) });
  assert.strictEqual(badRun.status, 1, `invalid marker must exit 1, got ${badRun.status}: ${badRun.stderr}`);

  // d. usage-log 命令自身运行也写使用日志（WB_USAGE_LOG 指向同一文件）
  const logD = path.join(logDir, 'self.jsonl');
  fs.writeFileSync(logD, line1 + '\n' + line2 + '\n');
  const selfRun = runCliRaw(['usage-log', 'mark', '--file', logD, '--line', '2', '--marker', 'helped', '--quiet'], { env: envWith(logD) });
  assert.strictEqual(selfRun.status, 0, selfRun.stderr);
  const afterD = readLines(logD);
  assert.strictEqual(afterD.length, 3, 'the mark run must append its own usage line');
  assert.strictEqual(JSON.parse(afterD[0]).command, 'impact', 'line 1 must stay untouched');
  assert.strictEqual(JSON.parse(afterD[1]).marker, 'helped');
  const selfEntry = JSON.parse(afterD[2]);
  assert.strictEqual(selfEntry.command, 'usage-log');
  assert.strictEqual(selfEntry.exitCode, 0);
  for (const field of LOG_FIELDS) {
    assert.ok(Object.prototype.hasOwnProperty.call(selfEntry, field), `self usage line missing field: ${field}`);
  }

  console.log('usage-log-test.js: all passed');
} finally {
  cleanupTempDir(fixDir);
  cleanupTempDir(logDir);
}
