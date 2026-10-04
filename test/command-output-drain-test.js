// @semantic
const assert = require('assert');
const { EventEmitter } = require('events');
const cp = require('child_process');
const { runCommandSecure } = require('../src/utils/command');

async function main() {
  const originalSpawn = cp.spawn;
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  child.stdout.destroy = () => {};
  child.stderr.destroy = () => {};
  cp.spawn = () => child;
  try {
    let settled = false;
    const pending = runCommandSecure('git', ['diff'], process.cwd(), 1000)
      .then((result) => { settled = true; return result; });
    child.stdout.emit('data', Buffer.from('header\n'));
    child.emit('exit', 0, null);
    await Promise.resolve();
    assert.strictEqual(settled, false, 'process exit must not resolve before its output streams close');
    child.stdout.emit('data', Buffer.from('@@ -1 +1 @@\n+changed\n'));
    child.stderr.emit('data', Buffer.from('final warning\n'));
    child.emit('close', 0, null);
    const result = await pending;
    assert.strictEqual(result.exitCode, 0);
    assert.strictEqual(result.stdout, 'header\n@@ -1 +1 @@\n+changed\n');
    assert.strictEqual(result.stderr, 'final warning\n');
    console.log('OK command returns complete stdout and stderr after close');
  } finally {
    cp.spawn = originalSpawn;
    child.emit('close', 0, null);
  }
  const buffered = await runCommandSecure(process.execPath, ['-e',
    'process.stdout.write("x".repeat(256 * 1024)); process.stderr.write("y".repeat(128 * 1024));',
  ], process.cwd(), 10000);
  assert.strictEqual(buffered.exitCode, 0);
  assert.strictEqual(buffered.stdout, 'x'.repeat(256 * 1024));
  assert.strictEqual(buffered.stderr, 'y'.repeat(128 * 1024));
  const failed = await runCommandSecure(process.execPath, ['-e',
    'process.stdout.write("failure detail"); process.exitCode = 7;',
  ], process.cwd(), 10000);
  assert.strictEqual(failed.exitCode, 7);
  assert.strictEqual(failed.stdout, 'failure detail');
  const timedOut = await runCommandSecure(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], process.cwd(), 150);
  assert.strictEqual(timedOut.exitCode, 124);
  assert.strictEqual(timedOut.timedOut, true);
  console.log('OK real child output, nonzero exits and timeout remain correct');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
