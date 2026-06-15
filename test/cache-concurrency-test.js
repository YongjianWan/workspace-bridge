#!/usr/bin/env node
// @semantic
/**
 * Cache concurrency stress test: verify SQLite WAL mode handles parallel reads safely.
 * Two CLI processes share the same cache directory; both must succeed without lock errors.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');
const CLI_PATH = path.join(REPO_ROOT, 'cli.js');

function runCliAsync(args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [CLI_PATH, ...args], {
      cwd: opts.cwd || REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => {
      resolve({ status: code, stdout, stderr });
    });
    child.on('error', (err) => reject(err));
  });
}

async function testConcurrentCacheAccess() {
  const sharedCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-concurrency-'));
  try {
    const args = ['audit-summary', '--cwd', REPO_ROOT, '--cache-dir', sharedCacheDir, '--json', '--quiet'];

    // Launch two concurrent processes sharing the same cache directory
    const [r1, r2] = await Promise.all([
      runCliAsync(args),
      runCliAsync(args),
    ]);

    assert.strictEqual(r1.status, 0, `Process 1 exited ${r1.status}. stderr: ${r1.stderr?.slice(0, 200)}`);
    assert.strictEqual(r2.status, 0, `Process 2 exited ${r2.status}. stderr: ${r2.stderr?.slice(0, 200)}`);

    const data1 = JSON.parse(r1.stdout);
    const data2 = JSON.parse(r2.stdout);
    assert.strictEqual(data1.ok, true, 'Process 1 should return ok=true');
    assert.strictEqual(data2.ok, true, 'Process 2 should return ok=true');
    assert.strictEqual(data1.schemaVersion, data2.schemaVersion, 'Both should return same schemaVersion');

    // Verify no SQLite lock/busy errors in stderr
    const lockErrorPattern = /database is locked|SQLITE_BUSY|EBUSY/i;
    assert(!lockErrorPattern.test(r1.stderr), `Process 1 stderr should not contain lock errors: ${r1.stderr?.slice(0, 200)}`);
    assert(!lockErrorPattern.test(r2.stderr), `Process 2 stderr should not contain lock errors: ${r2.stderr?.slice(0, 200)}`);
  } finally {
    try { fs.rmSync(sharedCacheDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

async function testSequentialThenConcurrentCacheAccess() {
  const sharedCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-concurrency-seq-'));
  try {
    const args = ['audit-summary', '--cwd', REPO_ROOT, '--cache-dir', sharedCacheDir, '--json', '--quiet'];

    // First run populates the cache
    const r1 = await runCliAsync(args);
    assert.strictEqual(r1.status, 0, 'Sequential run should succeed');

    // Two concurrent reads against populated cache
    const [r2, r3] = await Promise.all([
      runCliAsync(args),
      runCliAsync(args),
    ]);

    assert.strictEqual(r2.status, 0, 'Concurrent read 1 should succeed');
    assert.strictEqual(r3.status, 0, 'Concurrent read 2 should succeed');

    const data1 = JSON.parse(r1.stdout);
    const data2 = JSON.parse(r2.stdout);
    const data3 = JSON.parse(r3.stdout);
    assert.strictEqual(data1.health?.healthScore, data2.health?.healthScore, 'Cache should be consistent across reads');
    assert.strictEqual(data2.health?.healthScore, data3.health?.healthScore, 'Cache should be consistent across concurrent reads');
  } finally {
    try { fs.rmSync(sharedCacheDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

async function main() {
  await testConcurrentCacheAccess();
  await testSequentialThenConcurrentCacheAccess();
  console.log('cache-concurrency-test.js: all passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
