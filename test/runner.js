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
const { spawn, spawnSync } = require('child_process');
const { TIMEOUTS } = require('../src/config/constants');

const TEST_DIR = __dirname;
const REPO_ROOT = path.join(__dirname, '..');
const TIMEOUT_MS = parseInt(process.env.TEST_TIMEOUT_MS, 10) || TIMEOUTS.TEST_RUNNER_MS;

// Warm-cache for slow tests: a pre-built graph of the workspace-bridge repo itself.
// Slow tests copy this into their isolated cache directory to skip the expensive
// cold-start (file indexing + AST parsing + graph build) on every spawn.
const WARM_CACHE_DIR = path.join(os.tmpdir(), 'wb-runner-warm-cache');
const WARM_CACHE_READY = path.join(WARM_CACHE_DIR, '.ready');

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
  /formatter-e2e-summary-test\.js$/,
  /formatter-e2e-others-test\.js$/,
  /cli-integration-core-test\.js$/,
  /cli-integration-edge-test\.js$/,
  /cli-integration-query-test\.js$/,
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

const classificationCache = new Map(); // file -> { layer, reason }

/**
 * Classify a test AND record which rule decided it.
 *
 * The reason matters as much as the layer: rules 1–2 are declarations (someone
 * wrote `@slow` / listed the filename), rule 3 is a GUESS from which API the
 * file mentions — `new ServiceContainer` means "probably slow", never "measured
 * slow". A file demoted by rule 3 lands in the concurrency-2 queue without
 * anyone deciding it should, and nothing in the output ever said so. Emitting
 * the reason into the run report is what turns that into a countable fact
 * (see docs/TECH_DEBT.md 测试执行债 阶段 1).
 * @returns {{layer: string, reason: string}}
 */
function classifyTestDetail(file) {
  const cached = classificationCache.get(file);
  if (cached) return cached;

  const decide = (layer, reason) => {
    const value = { layer, reason };
    classificationCache.set(file, value);
    return value;
  };

  if (/watch/.test(file)) return decide('watch', 'filename-watch');

  let content = '';
  let readOk;
  try {
    content = fs.readFileSync(path.join(TEST_DIR, file), 'utf8');
    readOk = true;
  } catch {
    readOk = false;
  }

  // Priority 1: file-level annotation in first 10 lines
  if (readOk) {
    const header = content.split('\n').slice(0, 10).join('\n');
    if (header.includes('@slow')) return decide('slow', 'annotation-slow');
    if (header.includes('@watch')) return decide('watch', 'annotation-watch');
    if (header.includes('@serial')) return decide('serial', 'annotation-serial');
  }

  // Priority 2: known filename patterns
  if (KNOWN_SLOW_PATTERNS.some((p) => p.test(file))) {
    return decide('slow', 'known-slow-pattern');
  }

  // Priority 3: content heuristics — a guess, not a measurement.
  if (readOk) {
    if (/runCli|runCliRaw|runCliText/.test(content)) {
      return decide('slow', 'heuristic-runcli');
    }
    if (/spawnSync\(['"]node['"].*cli\.js/.test(content)) {
      return decide('slow', 'heuristic-spawn-cli');
    }
    // Heavy internal API usage ≈ a full CLI cold start (ServiceContainer init, graph build, etc.)
    if (/(new\s+ServiceContainer|new\s+FileIndex|DependencyGraph\.fromSchema|createServiceContainer)/.test(content)) {
      return decide('slow', 'heuristic-heavy-api');
    }
  }

  return decide('fast', 'default-fast');
}

function classifyTest(file) {
  return classifyTestDetail(file).layer;
}

/**
 * Determine whether a test needs an isolated per-test cache directory.
 * Fast tests that do not spawn child processes or touch the cache directly
 * do not need a WB_TEST_CACHE_DIR, saving NTFS mkdtemp/rm overhead.
 */
function needsCacheDir(file) {
  if (classifyTest(file) !== 'fast') return true;
  try {
    const content = fs.readFileSync(path.join(TEST_DIR, file), 'utf8');
    return /runCli|runCliRaw|runCliText|spawnSync|child_process|WB_TEST_CACHE_DIR/.test(content);
  } catch {
    return true;
  }
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
      if (/runCli|runCliRaw|runCliText|spawnSync|child_process|(new\s+ServiceContainer|new\s+FileIndex|DependencyGraph\.fromSchema|createServiceContainer)/.test(content)) {
        warnings.push(`  ${file}: contains runCli/spawnSync/child_process/heavy-API but classified as fast. Add // @slow to its header.`);
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

const serialFiles = files.filter((f) => /watch/.test(f) || classifyTest(f) === 'serial');
const concurrentFiles = files.filter((f) => !/watch/.test(f) && classifyTest(f) !== 'serial');

/* -------------------------------------------------------------------------- */
// Concurrency: default to CPU count (capped) for much faster execution.
/* -------------------------------------------------------------------------- */
const FAST_CONCURRENCY = parseInt(process.env.TEST_CONCURRENCY, 10)
  || Math.min(12, os.cpus().length || 4);
// Derived from the machine, not a magic 2. Slow tests spawn a CLI each, so the
// right ceiling scales with cores — a fixed 2 under-uses an 18-thread laptop
// and a fixed 6 would thrash a 2-core CI runner.
//
// Measured 2026-07-30 (114 slow tests, pool scheduling, this 18-thread box):
//   C=2 466s | C=4 317s (-32%) | C=6 260s (-18%)
// CPU cost rose 903s → 1167s → 1413s, so C=6 trades 21% more CPU for 18% less
// wall clock — roughly break-even, and it cut timeout headroom on the longest
// test from 3.3x to 2.7x. This suite's historical failure mode is spawn tests
// timing out under load and reading as regressions, which costs far more to
// investigate than the 57s C=6 would save. Hence the cap at 4.
const SLOW_CONCURRENCY = parseInt(process.env.TEST_SLOW_CONCURRENCY, 10)
  || Math.min(4, Math.max(2, Math.floor((os.cpus().length || 4) / 4)), FAST_CONCURRENCY);

let passed = 0;
let failed = 0;
const failures = [];
const start = Date.now();

/* -------------------------------------------------------------------------- */
// Run report: per-test timing/layer/batch/exit-code to a JSON file.
//
// stdout is not a record. A backgrounded run keeps its tail and loses the
// distribution, which is exactly what happened on 2026-07-29 — the question
// "which slow tests are actually slow" had no answer afterwards. Everything
// needed to answer it already passes through this file; it was just never
// written down.
/* -------------------------------------------------------------------------- */
const REPORT_DIR = process.env.TEST_REPORT_DIR || path.join(TEST_DIR, '.reports');
const REPORT_DISABLED = process.env.TEST_REPORT === '0';
const runRecords = [];
// Calibration probe: the warm-cache build is a cold `audit-summary` on this
// repo — the one timing on this machine with a known-healthy band (12–14s).
// Deliberately NOT WMI clock speed: on this hardware CurrentClockSpeed equals
// MaxClockSpeed equals the P-core base frequency at all times, so it reports
// 1200 whether the machine is healthy or crawling. Recording it would stamp
// every report with a number that cannot discriminate.
let warmup = { ms: null, source: 'skipped' };

function recordResult(r, phase, concurrency, phaseStart) {
  const { layer, reason } = classifyTestDetail(r.file);
  runRecords.push({
    file: r.file,
    layer,
    classifiedBy: reason,
    phase,
    concurrency,
    // Completion offset from the phase start. Replaces the old batch index:
    // the pool has no batches, and offsets are what let you reconstruct the
    // timeline and spot idle gaps (see runPool).
    finishOffsetMs: phaseStart ? Date.now() - phaseStart : 0,
    elapsedMs: r.elapsed,
    ok: r.ok,
    status: r.status,
    signal: r.signal || null,
    error: r.err ? String(r.err.message || r.err) : null,
  });
}

function writeRunReport(totalMs) {
  if (REPORT_DISABLED) return null;
  const report = {
    startedAt: new Date(start).toISOString(),
    totalMs,
    layer: requestedLayer || (smokeMode ? 'smoke' : 'all'),
    counts: { total: files.length, passed, failed },
    env: {
      node: process.version,
      platform: process.platform,
      cpus: os.cpus().length,
      fastConcurrency: FAST_CONCURRENCY,
      slowConcurrency: SLOW_CONCURRENCY,
      timeoutMs: TIMEOUT_MS,
      // source 'built' → ms is a fresh cold `audit-summary`; compare against
      // the 12–14s healthy band before trusting any timing here as a baseline.
      // 'reused'/'skipped' → this run measured nothing, so it carries no
      // calibration of its own.
      warmup,
    },
    tests: runRecords,
  };
  try {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    const stamp = new Date(start).toISOString().replace(/[:.]/g, '-');
    const file = path.join(REPORT_DIR, `run-${stamp}.json`);
    const json = JSON.stringify(report, null, 2);
    fs.writeFileSync(file, json);
    // Stable name so tooling does not have to glob for the newest stamp.
    fs.writeFileSync(path.join(REPORT_DIR, 'latest.json'), json);
    return file;
  } catch (e) {
    console.warn(`[runner] could not write run report: ${e.message}`);
    return null;
  }
}

function runOne(file) {
  const filePath = path.join(TEST_DIR, file);
  const testStart = Date.now();
  const useCache = needsCacheDir(file);

  // Isolate SQLite cache per test to eliminate lock contention under concurrency.
  const testCacheDir = useCache
    ? fs.mkdtempSync(path.join(os.tmpdir(), 'wb-runner-cache-'))
    : null;

  // Copy warm cache for slow tests to skip expensive cold-start rebuild.
  if (testCacheDir && classifyTest(file) === 'slow' && fs.existsSync(WARM_CACHE_READY)) {
    try {
      fs.cpSync(WARM_CACHE_DIR, testCacheDir, { recursive: true, force: true, dereference: true });
    } catch {
      // Non-fatal: fall back to cold start.
    }
  }

  return new Promise((resolve) => {
    let settled = false;
    function settle(value) {
      if (settled) return;
      settled = true;
      resolve(value);
    }

    const childEnv = useCache
      ? { ...process.env, WB_TEST_CACHE_DIR: testCacheDir }
      : process.env;

    const testTimeout = file === 'e2e-gitnexus-test.js' ? Math.max(300000, TIMEOUT_MS) : TIMEOUT_MS;

    const child = spawn('node', [filePath], {
      timeout: testTimeout,
      env: childEnv,
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
      if (testCacheDir) {
        try { fs.rmSync(testCacheDir, { recursive: true, force: true }); } catch {}
      }
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
    }, testTimeout + TIMEOUTS.TEST_RUNNER_KILL_GRACE_MS);

    child.on('close', () => clearTimeout(killTimer));
  });
}

/**
 * Keep `concurrency` tests in flight at all times, starting the next one the
 * moment any slot frees.
 *
 * Was: lock-step batches (`for i += concurrency { await Promise.all(slice) }`),
 * which is a barrier, not a pool — every batch waited for its slowest member.
 * Measured on the 2026-07-30 baseline (114 slow tests, concurrency 2): 940s of
 * CPU work spread over 775s of wall clock, **579s of it idle waiting**. One
 * batch paired e2e-gitnexus (92.1s) with file-index-boundary (0.4s) and burned
 * 91.7s of a worker doing nothing. A pool's wall-clock floor is
 * max(totalWork/concurrency, longestSingleTest) = max(470s, 92s).
 *
 * Results are handled in completion order, which is why the report records
 * startOffsetMs instead of a batch index — with a pool there are no batches,
 * and the offset is what reconstructs the timeline.
 */
async function runPool(phaseFiles, concurrency, onResult) {
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, phaseFiles.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= phaseFiles.length) return;
      const result = await runOne(phaseFiles[index]);
      onResult(result);
    }
  });
  await Promise.all(workers);
}

async function runSerial(filesList) {
  for (const file of filesList) {
    const r = await runOne(file);
    recordResult(r, 'serial', 1, null);
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
  const phaseStart = Date.now();
  await runPool(phaseFiles, concurrency, (r) => {
    recordResult(r, phaseLabel || 'concurrent', concurrency, phaseStart);
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
  });
}

/**
 * Pre-warm a shared cache against the workspace-bridge repo itself.
 * Slow tests that operate on the main repo can copy this warm cache
 * into their isolated test cache directory, skipping the expensive
 * cold-start graph build + WASM initialization on every spawn.
 */
function warmCache() {
  // Skip warm-up for fast-only runs (no slow tests need it).
  if (requestedLayer === 'fast') return;

  // Re-use if still fresh (5 min TTL).
  if (fs.existsSync(WARM_CACHE_READY)) {
    try {
      const stat = fs.statSync(WARM_CACHE_READY);
      if (Date.now() - stat.mtimeMs < 5 * 60 * 1000) {
        warmup = { ms: null, source: 'reused' };
        return;
      }
    } catch {
      // stale / unreadable → rebuild
    }
  }

  // Clean stale cache
  try { fs.rmSync(WARM_CACHE_DIR, { recursive: true, force: true }); } catch {}

  const CLI_PATH = path.join(REPO_ROOT, 'cli.js');
  console.log('[runner] Warming cache for slow tests...');
  const warmStart = Date.now();
  const result = spawnSync('node', [CLI_PATH, 'audit-summary', '--cwd', REPO_ROOT, '--cache-dir', WARM_CACHE_DIR, '--quiet', '--json'], {
    encoding: 'utf8',
    timeout: 120000,
    stdio: 'pipe',
    env: { ...process.env, WB_TEST_CACHE_DIR: WARM_CACHE_DIR },
  });

  if (result.status === 0) {
    fs.writeFileSync(WARM_CACHE_READY, '');
    warmup = { ms: Date.now() - warmStart, source: 'built' };
    console.log(`[runner] Cache warmed in ${warmup.ms}ms`);
  } else {
    warmup = { ms: Date.now() - warmStart, source: 'failed' };
    console.warn(`[runner] Cache warm-up failed (exit ${result.status}), slow tests will cold-start. stderr: ${(result.stderr || '').slice(0, 200)}`);
  }
}

async function main() {
  // Self-check: warn about tests that look slow but are classified as fast.
  validateSlowClassification(files);

  // Pre-warm cache before any slow tests run.
  warmCache();

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

  // Before the failure exit, not after: a failed run is the one whose timing
  // distribution you most want to read afterwards.
  const reportPath = writeRunReport(elapsed);
  if (reportPath) console.log(`Run report: ${path.relative(REPO_ROOT, reportPath)}`);

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

// Guarded so the classification rules can be required and asserted without
// launching a full run (test/runner-report-test.js).
if (require.main === module) {
  main();
}

module.exports = { classifyTest, classifyTestDetail };
