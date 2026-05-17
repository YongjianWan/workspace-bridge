#!/usr/bin/env node
/**
 * Lightweight concurrent test runner for workspace-bridge.
 *
 * Replaces the &&-chained test:all so that every test runs even if one fails.
 * Most tests run concurrently (they use unique temp directories).
 * fs.watch-based tests run serially to avoid watcher cross-talk.
 *
 * Safety: each test has a hard timeout. If a single test hangs,
 * it is killed and marked as a failure — the runner never blocks.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { TIMEOUTS } = require('../src/config/constants');

const TEST_DIR = __dirname;
const TIMEOUT_MS = parseInt(process.env.TEST_TIMEOUT_MS, 10) || TIMEOUTS.TEST_RUNNER_MS;
const CONCURRENCY = parseInt(process.env.TEST_CONCURRENCY, 10) || 1;

const files = fs
  .readdirSync(TEST_DIR)
  .filter((f) => f.endsWith('.js') && f !== 'runner.js' && f !== 'test-helpers.js')
  .sort();

const serialFiles = files.filter((f) => /watch/.test(f));
const concurrentFiles = files.filter((f) => !/watch/.test(f));

let passed = 0;
let failed = 0;
const failures = [];
const start = Date.now();

function runOne(file) {
  const filePath = path.join(TEST_DIR, file);
  const testStart = Date.now();

  return new Promise((resolve) => {
    let settled = false;
    function settle(value) {
      if (settled) return;
      settled = true;
      resolve(value);
    }

    const child = spawn('node', [filePath], {
      timeout: TIMEOUT_MS,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });

    child.on('error', (err) => {
      settle({
        file, ok: false, status: null, signal: null, err, stdout, stderr,
        elapsed: Date.now() - testStart,
      });
    });

    child.on('close', (status, signal) => {
      const elapsed = Date.now() - testStart;
      const ok = status === 0 && !signal;
      settle({ file, ok, status, signal, stdout, stderr, elapsed });
    });

    // Ultimate safety net: if the child refuses to die after spawn timeout,
    // force SIGKILL and resolve so the runner never blocks.
    const killTimer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      settle({
        file, ok: false, status: null, signal: 'TIMEOUT', stdout, stderr,
        elapsed: Date.now() - testStart,
      });
    }, TIMEOUT_MS + TIMEOUTS.TEST_RUNNER_KILL_GRACE_MS);

    child.on('close', () => clearTimeout(killTimer));
  });
}

async function runBatch(batch) {
  return Promise.all(batch.map(runOne));
}

async function runSerial(filesList) {
  for (const file of filesList) {
    const r = await runOne(file);
    if (r.ok) {
      passed += 1;
      const label = r.elapsed > TIMEOUTS.TEST_SLOW_THRESHOLD_MS ? `PASS (${r.elapsed}ms) SLOW` : `PASS (${r.elapsed}ms)`;
      console.log(`→ ${r.file} ... ${label}`);
    } else {
      failed += 1;
      console.log(`→ ${r.file} ... FAIL`);
      failures.push(r);
      if (r.stdout) console.log(r.stdout);
      if (r.stderr) console.error(r.stderr);
      if (r.err) console.error(r.err.message);
    }
  }
}

async function main() {
  // Concurrent phase
  for (let i = 0; i < concurrentFiles.length; i += CONCURRENCY) {
    const batch = concurrentFiles.slice(i, i + CONCURRENCY);
    const results = await runBatch(batch);

    for (const r of results) {
      if (r.ok) {
        passed += 1;
        const label = r.elapsed > 10000 ? `PASS (${r.elapsed}ms) SLOW` : `PASS (${r.elapsed}ms)`;
        console.log(`→ ${r.file} ... ${label}`);
      } else {
        failed += 1;
        console.log(`→ ${r.file} ... FAIL`);
        failures.push(r);
        if (r.stdout) console.log(r.stdout);
        if (r.stderr) console.error(r.stderr);
        if (r.err) console.error(r.err.message);
      }
    }
  }

  // Serial phase (watch tests)
  if (serialFiles.length > 0) {
    await runSerial(serialFiles);
  }

  const elapsed = Date.now() - start;
  const separator = '-'.repeat(60);

  console.log(`\n${separator}`);
  console.log(`Ran ${files.length} tests in ${elapsed}ms`);
  console.log(`${passed} passed, ${failed} failed`);

  if (failures.length > 0) {
    console.log(`\nFailed tests:`);
    for (const f of failures) {
      const reason = f.signal === 'TIMEOUT'
        ? 'timed out'
        : f.signal
          ? `signal ${f.signal}`
          : f.err
            ? `error ${f.err.message}`
            : `exit ${f.status}`;
      console.log(`  - ${f.file} (${reason})`);
    }
    process.exit(1);
  }

  console.log('\nAll tests passed.');
}

main();
