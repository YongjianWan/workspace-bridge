#!/usr/bin/env node
/**
 * Direct unit tests for spawn-ast.js edge cases not covered by
 * spawn-ast-test.js (SIGKILL) or spawn-ast-concurrency-test.js (semaphore).
 */
const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const EventEmitter = require('events');

const originalSpawn = cp.spawn;
const originalExistsSync = fs.existsSync;

function createMockProcess() {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const stdin = new EventEmitter();
  stdin.write = () => true;
  stdin.end = () => {};
  const proc = new EventEmitter();
  proc.stdout = stdout;
  proc.stderr = stderr;
  proc.stdin = stdin;
  proc.unref = () => {};
  proc.kill = () => {};
  return proc;
}

function setupModule() {
  delete require.cache[require.resolve('../src/services/dep-graph/parsers/spawn-ast')];
  return require('../src/services/dep-graph/parsers/spawn-ast');
}

async function testScriptNotFoundReturnsNull() {
  fs.existsSync = () => false;
  const { spawnPythonASTParser } = setupModule();
  const result = await spawnPythonASTParser('missing.py', 'content');
  assert.strictEqual(result, null, 'missing script should resolve null');
}

async function testSuccessfulJsonParse() {
  fs.existsSync = () => true;
  let mockProc;
  cp.spawn = () => {
    mockProc = createMockProcess();
    setImmediate(() => {
      mockProc.stdout.emit('data', JSON.stringify({ imports: [], exports: [] }));
      mockProc.emit('close', 0);
    });
    return mockProc;
  };
  const { spawnPythonASTParser } = setupModule();
  const result = await spawnPythonASTParser('dummy.py', 'content', 5000);
  assert.deepStrictEqual(result, { imports: [], exports: [] }, 'should parse JSON result');
}

async function testNonZeroExitReturnsNull() {
  fs.existsSync = () => true;
  let mockProc;
  cp.spawn = () => {
    mockProc = createMockProcess();
    setImmediate(() => {
      mockProc.stderr.emit('data', 'some error');
      mockProc.emit('close', 1);
    });
    return mockProc;
  };
  const { spawnPythonASTParser } = setupModule();
  const result = await spawnPythonASTParser('dummy.py', 'content', 5000);
  assert.strictEqual(result, null, 'non-zero exit should resolve null');
}

async function testStdoutTruncation() {
  fs.existsSync = () => true;
  let mockProc;
  cp.spawn = () => {
    mockProc = createMockProcess();
    let stdoutDestroyed = false;
    mockProc.stdout.destroy = () => { stdoutDestroyed = true; };
    setImmediate(() => {
      const huge = 'x'.repeat(10 * 1024 * 1024 + 1);
      mockProc.stdout.emit('data', huge);
      assert(stdoutDestroyed, 'stdout should be destroyed after truncation');
      mockProc.emit('close', 1);
    });
    return mockProc;
  };
  const { spawnPythonASTParser } = setupModule();
  await spawnPythonASTParser('dummy.py', 'content', 5000);
}

async function testStderrTruncation() {
  fs.existsSync = () => true;
  let mockProc;
  cp.spawn = () => {
    mockProc = createMockProcess();
    let stderrDestroyed = false;
    mockProc.stderr.destroy = () => { stderrDestroyed = true; };
    setImmediate(() => {
      const huge = 'x'.repeat(10 * 1024 * 1024 + 1);
      mockProc.stderr.emit('data', huge);
      assert(stderrDestroyed, 'stderr should be destroyed after truncation');
      mockProc.emit('close', 1);
    });
    return mockProc;
  };
  const { spawnPythonASTParser } = setupModule();
  await spawnPythonASTParser('dummy.py', 'content', 5000);
}

async function testSpawnErrorReturnsNull() {
  fs.existsSync = () => true;
  let mockProc;
  cp.spawn = () => {
    mockProc = createMockProcess();
    setImmediate(() => {
      mockProc.emit('error', new Error('ENOENT'));
    });
    return mockProc;
  };
  const { spawnPythonASTParser } = setupModule();
  const result = await spawnPythonASTParser('dummy.py', 'content', 5000);
  assert.strictEqual(result, null, 'spawn error should resolve null');
}

async function testStdinWriteErrorReturnsNull() {
  fs.existsSync = () => true;
  let mockProc;
  cp.spawn = () => {
    mockProc = createMockProcess();
    mockProc.stdin.write = () => { throw new Error('EPIPE'); };
    setImmediate(() => {
      mockProc.emit('close', 1);
    });
    return mockProc;
  };
  const { spawnPythonASTParser } = setupModule();
  const result = await spawnPythonASTParser('dummy.py', 'content', 5000);
  assert.strictEqual(result, null, 'stdin write error should resolve null');
}

async function testInvalidJsonReturnsNull() {
  fs.existsSync = () => true;
  let mockProc;
  cp.spawn = () => {
    mockProc = createMockProcess();
    setImmediate(() => {
      mockProc.stdout.emit('data', 'not-json');
      mockProc.emit('close', 0);
    });
    return mockProc;
  };
  const { spawnPythonASTParser } = setupModule();
  const result = await spawnPythonASTParser('dummy.py', 'content', 5000);
  assert.strictEqual(result, null, 'invalid JSON should resolve null');
}

async function main() {
  try {
    await testScriptNotFoundReturnsNull();
    console.log('script-not-found: ok');

    await testSuccessfulJsonParse();
    console.log('successful-json: ok');

    await testNonZeroExitReturnsNull();
    console.log('non-zero-exit: ok');

    await testStdoutTruncation();
    console.log('stdout-truncation: ok');

    await testStderrTruncation();
    console.log('stderr-truncation: ok');

    await testSpawnErrorReturnsNull();
    console.log('spawn-error: ok');

    await testStdinWriteErrorReturnsNull();
    console.log('stdin-write-error: ok');

    await testInvalidJsonReturnsNull();
    console.log('invalid-json: ok');

    console.log('\nspawn-ast-direct-test: all passed');
  } finally {
    cp.spawn = originalSpawn;
    fs.existsSync = originalExistsSync;
    delete require.cache[require.resolve('../src/services/dep-graph/parsers/spawn-ast')];
  }
}

main().catch((err) => {
  cp.spawn = originalSpawn;
  fs.existsSync = originalExistsSync;
  console.error('Test failed:', err.message);
  process.exit(1);
});
