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
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { TIMEOUTS } = require('../src/config/constants');

const TEST_DIR = __dirname;
const TIMEOUT_MS = parseInt(process.env.TEST_TIMEOUT_MS, 10) || TIMEOUTS.TEST_RUNNER_MS;

/* -------------------------------------------------------------------------- */
// CLI argument parsing
/* -------------------------------------------------------------------------- */
const args = process.argv.slice(2);
function parseLayerFlag(args) {
  // Support both `--layer=fast` and `--layer fast` forms.
  const eqIdx = args.findIndex((a) => a.startsWith('--layer='));
  if (eqIdx >= 0) return args[eqIdx].split('=')[1];
  const spaceIdx = args.indexOf('--layer');
  if (spaceIdx >= 0 && spaceIdx + 1 < args.length) return args[spaceIdx + 1];
  return null;
}
const requestedLayer = parseLayerFlag(args);
const smokeMode = args.includes('--smoke');

/* -------------------------------------------------------------------------- */
// Test classification (auto-detect by filename + content heuristics)
/* -------------------------------------------------------------------------- */

// Known heavy tests that spawn CLI against the full project or build large graphs.
const KNOWN_SLOW_PATTERNS = [
  /analysis-test\.js$/,
  /audit-diff-incremental-test\.js$/,
  /audit-file-validation-advice-test\.js$/,
  /audit-diff-test\.js$/,
  /functionality-test\.js$/,
  /regression-test\.js$/,
  /integration-core-test\.js$/,
  /formatter-e2e-test\.js$/,
  /cli-integration-test\.js$/,
  /staged-files-test\.js$/,
  /with-impact-test\.js$/,
  /gors-stack-detection-test\.js$/,
  /init-test\.js$/,
  /role-detection-test\.js$/,
  /severity-filter-test\.js$/,
  /cli-fallback-test\.js$/,
  /cli-error-handling-test\.js$/,
  /cli-args-validation-test\.js$/,
  /cli-mapper-adapter-test\.js$/,
  /implicit-imports-test\.js$/,
  /repl-test\.js$/,
];

const classificationCache = new Map();

function classifyTest(file) {
  if (classificationCache.has(file)) return classificationCache.get(file);

  if (/watch/.test(file)) {
    classificationCache.set(file, 'watch');
    return 'watch';
  }

  let content = '';
  let readOk = false;
  try {
    content = fs.readFileSync(path.join(TEST_DIR, file), 'utf8');
    readOk = true;
  } catch {
    readOk = false;
  }

  // Priority 1: file-level annotation in first 10 lines
  if (readOk) {
    const header = content.split('\n').slice(0, 10).join('\n');
    if (header.includes('@slow')) {
      classificationCache.set(file, 'slow');
      return 'slow';
    }
    if (header.includes('@watch')) {
      classificationCache.set(file, 'watch');
      return 'watch';
    }
  }

  // Priority 2: known filename patterns
  if (KNOWN_SLOW_PATTERNS.some((p) => p.test(file))) {
    classificationCache.set(file, 'slow');
    return 'slow';
  }

  // Priority 3: content heuristics
  if (readOk) {
    if (/runCli|runCliRaw|runCliText/.test(content)) {
      classificationCache.set(file, 'slow');
      return 'slow';
    }
    if (/spawnSync\(['"]node['"].*cli\.js/.test(content)) {
      classificationCache.set(file, 'slow');
      return 'slow';
    }
  }

  classificationCache.set(file, 'fast');
  return 'fast';
}

/* --------------------------------------------------------------------------
// Self-validation: warn if fast-classified tests contain slow indicators
// -------------------------------------------------------------------------- */
function validateSlowClassification(files) {
  const warnings = [];
  for (const file of files) {
    if (classifyTest(file) !== 'fast') continue;
    try {
      const content = fs.readFileSync(path.join(TEST_DIR, file), 'utf8');
      if (/runCli|runCliRaw|runCliText|spawnSync|child_process/.test(content)) {
        warnings.push(`  ${file}: contains runCli/spawnSync/child_process but classified as fast. Add // @slow to its header.`);
      }
    } catch {
      // ignore read errors
    }
  }
  if (warnings.length > 0) {
    console.warn('\n[runner] WARNING: potential slow-test misclassification detected:');
    for (const w of warnings) console.warn(w);
    console.warn('');
  }
}

/* -------------------------------------------------------------------------- */
// File discovery + layer filtering
/* -------------------------------------------------------------------------- */
let files = fs
  .readdirSync(TEST_DIR)
  .filter((f) => f.endsWith('.js') && f !== 'runner.js' && f !== 'test-helpers.js')
  .sort();

// Apply layer / smoke filtering
if (requestedLayer) {
  const validLayers = new Set(['fast', 'slow', 'watch', 'all']);
  if (!validLayers.has(requestedLayer)) {
    console.error(`Unknown layer: ${requestedLayer}. Valid: fast, slow, watch, all`);
    process.exit(2);
  }
  if (requestedLayer !== 'all') {
    files = files.filter((f) => classifyTest(f) === requestedLayer);
  }
} else if (smokeMode) {
  // Smoke = all fast tests (they run quickly at high concurrency) + a few
  // representative slow tests to verify CLI pipeline is not completely broken.
  const fastTests = files.filter((f) => classifyTest(f) === 'fast');
  const slowTests = files.filter((f) => classifyTest(f) === 'slow');

  // Prefer @smoke-representative annotated tests over pure alphabetical order.
  const representative = [];
  const remaining = [];
  for (const file of slowTests) {
    try {
      const content = fs.readFileSync(path.join(TEST_DIR, file), 'utf8');
      if (content.split('\n').slice(0, 10).join('\n').includes('@smoke-representative')) {
        representative.push(file);
      } else {
        remaining.push(file);
      }
    } catch {
      remaining.push(file);
    }
  }
  const selectedSlow = representative.length > 0
    ? representative.slice(0, 3)
    : slowTests.slice(0, 3);
  files = fastTests.concat(selectedSlow);
}

const serialFiles = files.filter((f) => /watch/.test(f));
const concurrentFiles = files.filter((f) => !/watch/.test(f));

/* -------------------------------------------------------------------------- */
// Concurrency: default to CPU count (capped) for much faster execution.
/* -------------------------------------------------------------------------- */
const FAST_CONCURRENCY = parseInt(process.env.TEST_CONCURRENCY, 10)
  || Math.min(12, os.cpus().length || 4);
const SLOW_CONCURRENCY = parseInt(process.env.TEST_SLOW_CONCURRENCY, 10)
  || Math.min(4, FAST_CONCURRENCY);

let passed = 0;
let failed = 0;
const failures = [];
const start = Date.now();

function runOne(file) {
  const filePath = path.join(TEST_DIR, file);
  const testStart = Date.now();

  // Isolate SQLite cache per test to eliminate lock contention under concurrency.
  const testCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-runner-cache-'));

  return new Promise((resolve) => {
    let settled = false;
    function settle(value) {
      if (settled) return;
      settled = true;
      resolve(value);
    }

    const child = spawn('node', [filePath], {
      timeout: TIMEOUT_MS,
      env: {
        ...process.env,
        WB_TEST_CACHE_DIR: testCacheDir,
      },
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
      // Clean up per-test cache directory regardless of outcome.
      try { fs.rmSync(testCacheDir, { recursive: true, force: true }); } catch {}
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

async function runConcurrentPhase(phaseFiles, concurrency, phaseLabel) {
  if (phaseFiles.length === 0) return;
  if (phaseLabel) {
    console.log(`\n[${phaseLabel}] ${phaseFiles.length} tests (concurrency=${concurrency})`);
  }
  for (let i = 0; i < phaseFiles.length; i += concurrency) {
    const batch = phaseFiles.slice(i, i + concurrency);
    const results = await runBatch(batch);

    for (const r of results) {
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
}

async function main() {
  // Self-check: warn about tests that look slow but are classified as fast.
  validateSlowClassification(files);

  // Phase 1: fast tests at higher concurrency — they finish quickly and should
  // not be held back by slow/integration tests in the same batch.
  const fastFiles = concurrentFiles.filter((f) => classifyTest(f) === 'fast');
  const slowFiles = concurrentFiles.filter((f) => classifyTest(f) === 'slow');

  await runConcurrentPhase(fastFiles, FAST_CONCURRENCY, 'Fast');
  await runConcurrentPhase(slowFiles, SLOW_CONCURRENCY, 'Slow');

  // Serial phase (watch tests)
  if (serialFiles.length > 0) {
    console.log('\n[Serial]', serialFiles.length, 'tests');
    await runSerial(serialFiles);
  }

  const elapsed = Date.now() - start;
  const separator = '-'.repeat(60);

  const layerLabel = requestedLayer ? ` [layer=${requestedLayer}]` : (smokeMode ? ' [smoke]' : '');
  console.log(`\n${separator}`);
  console.log(`Ran ${files.length} tests in ${elapsed}ms${layerLabel}`);
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
