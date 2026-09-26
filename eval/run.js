#!/usr/bin/env node
/**
 * workspace-bridge evaluation runner.
 *
 * Usage:
 *   node eval/run.js [repo ...] [--lang <lang>] [--force]
 *
 * For each corpus repo (default: all):
 *   1. ensure a clone at eval/truth/repos/<lang>/<name> pinned to the corpus
 *      commit (partial clone, blobs fetched on checkout only)
 *   2. health: audit-overview twice against an empty cache (cold, then warm),
 *      timed, with the cache pinned to eval/truth/out/<lang>/<name>/cache via
 *      WB_CACHE_DIR so size and predictions are read from a known place
 *        -> audit-overview.json, health.json
 *   3. dead-exports -> dead-exports.json (scored when labels exist; counts go
 *      into health.json either way)
 *   4. affected-tests truth:
 *        coverage-pytest — isolated venv, independent coverage rcfile (the
 *          repo's own coverage config may be parallel-mode and conflict), then
 *          python -m coverage run --rcfile=... -m pytest -q -p no:cacheprovider -p no:cov <tests>
 *          inside the clone, dumped to a per-file -> test-file map (gt.json)
 *        fault-injection — generated separately by eval/inject-fault.js
 *          (expensive); here it only stays pending until that has run
 *
 * Steps 2–3 are cached: skipped when outputs exist and neither the target
 * commit nor the newest src/ mtime changed; --force re-runs them.
 * Each repo's status.json records which metrics are ok vs pending (with
 * reason); eval/score.js consumes it.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const lib = require('./lib');

const { CLI, ROOT, VENVS_DIR, sh, tail, readJson, writeJson, readMarker, writeMarker, setStatus } = lib;

const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const log = (msg) => console.log(`[eval] ${msg}`);

const CLI_TIMEOUT_MS = 30 * 60 * 1000;
const PYTEST_TIMEOUT_MS = 45 * 60 * 1000;

// Per-repo failure: main() records it and moves on to the next repo.
function fail(msg, detail = '') {
  throw new Error(detail ? `${msg}\n${detail}` : msg);
}

function shOk(cmd, args, opts = {}) {
  const r = sh(cmd, args, opts);
  if (r.status !== 0) fail(`FAILED: ${cmd} ${args.join(' ')} (status ${r.status})`, `${tail(r.stdout)}\n${tail(r.stderr)}`);
  return r;
}

function findPython() {
  for (const cand of [['python'], ['python3'], ['py', '-3']]) {
    if (sh(cand[0], [...cand.slice(1), '--version']).status === 0) return cand;
  }
  return null;
}

function walkFiles(dir, visit) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, visit);
    else visit(p);
  }
}

function newestMtime(dir) {
  let max = 0;
  walkFiles(dir, (p) => {
    max = Math.max(max, fs.statSync(p).mtimeMs);
  });
  return max;
}

function dirBytes(dir) {
  let total = 0;
  walkFiles(dir, (p) => {
    total += fs.statSync(p).size;
  });
  return total;
}

// ---------------------------------------------------------------- clone

function ensureRepo(entry) {
  const dir = lib.repoDir(entry);
  if (!fs.existsSync(path.join(dir, '.git'))) {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    fs.rmSync(dir, { recursive: true, force: true });
    log(`${entry.name}: cloning ${entry.url}`);
    shOk('git', ['clone', '--filter=blob:none', '--no-checkout', entry.url, dir]);
  }
  const git = (...args) => sh('git', ['-C', dir, ...args]);
  if (git('cat-file', '-e', `${entry.commit}^{commit}`).status !== 0) {
    log(`${entry.name}: fetching to reach commit ${entry.commit}`);
    shOk('git', ['-C', dir, 'fetch', 'origin']);
  }
  const head = git('rev-parse', 'HEAD').stdout.trim();
  const dirty = git('status', '--porcelain', '--untracked-files=no').stdout.trim() !== '';
  if (!head.startsWith(entry.commit) || dirty) {
    log(`${entry.name}: checking out ${entry.commit}`);
    // -f discards leftover edits (e.g. an interrupted fault injection)
    shOk('git', ['-C', dir, 'checkout', '-f', '--detach', entry.commit]);
  }
  const verify = git('rev-parse', 'HEAD').stdout.trim();
  if (!verify.startsWith(entry.commit)) fail(`${entry.name}: HEAD ${verify} does not match pinned ${entry.commit}`);
  return dir;
}

// ---------------------------------------------------------------- CLI steps

const cacheDirFor = (entry) => path.join(lib.outDir(entry), 'cache');

function runCli(entry, repoDir, command) {
  const started = process.hrtime.bigint();
  const r = sh(process.execPath, [CLI, command, '--cwd', repoDir, '--json', '--quiet'], {
    env: { ...process.env, WB_CACHE_DIR: cacheDirFor(entry) },
    timeout: CLI_TIMEOUT_MS,
  });
  const ms = Number((process.hrtime.bigint() - started) / 1000000n);
  if (r.status !== 0) fail(`${entry.name}: ${command} failed (status ${r.status})`, `${tail(r.stdout)}\n${tail(r.stderr)}`);
  let parsed;
  try {
    parsed = JSON.parse(r.stdout);
  } catch {
    fail(`${entry.name}: ${command} produced unparseable JSON`, tail(r.stdout, 300));
  }
  if (parsed.ok === false) fail(`${entry.name}: ${command} returned ok=false`, JSON.stringify(parsed.error || parsed).slice(0, 500));
  return { parsed, ms };
}

function isCached(entry, srcMtime, files) {
  const m = readMarker(entry);
  return !FORCE && m.commit === entry.commit && m.srcMtimeMs === srcMtime && files.every((f) => fs.existsSync(f));
}

function deadExportCounts(deadExports) {
  const byConfidence = {};
  let symbols = 0;
  for (const item of deadExports.deadExports || []) {
    const n = (item.exports || []).length;
    const c = item.confidence || 'unknown';
    byConfidence[c] = (byConfidence[c] || 0) + n;
    symbols += n;
  }
  return { symbols, byConfidence };
}

function healthOf(overview, coldMs, warmMs, cacheBytes) {
  const cov = overview.analysisCoverage || {};
  const languages = {};
  for (const [lang, s] of Object.entries(overview.languageSupport || {})) {
    languages[lang] = { files: s.files, astFiles: s.astFiles, regexFiles: s.regexFiles };
  }
  return {
    coldMs,
    warmMs,
    cacheBytes,
    totalFiles: cov.totalFiles,
    coverageRatio: cov.coverageRatio,
    fallbackFiles: cov.fallbackFiles,
    unsupportedFiles: cov.unsupportedFiles,
    unresolvedCount: (overview.unresolved || {}).unresolvedCount,
    droppedCount: (overview.droppedImports || {}).droppedCount,
    warnings: (overview.warnings || []).length,
    languages,
  };
}

// Cold and warm runs of the same commit must agree; any field that differs is
// a cache-consistency bug surfacing (the agent only ever sees one of them).
const COLD_WARM_KEYS = ['totalFiles', 'coverageRatio', 'fallbackFiles', 'unresolvedCount', 'droppedCount', 'warnings'];

function coldWarmDiff(coldOverview, warmOverview) {
  const cold = healthOf(coldOverview);
  const warm = healthOf(warmOverview);
  const diff = {};
  for (const k of COLD_WARM_KEYS) if (cold[k] !== warm[k]) diff[k] = { cold: cold[k], warm: warm[k] };
  return diff;
}

function runCliSteps(entry, repoDir, srcMtime) {
  const out = lib.outDir(entry);
  const files = ['audit-overview.json', 'dead-exports.json', 'health.json'].map((f) => path.join(out, f));
  if (isCached(entry, srcMtime, files)) {
    log(`${entry.name}: CLI outputs cached, skip (use --force to re-run)`);
    return;
  }
  fs.rmSync(cacheDirFor(entry), { recursive: true, force: true });
  log(`${entry.name}: audit-overview (cold)`);
  const cold = runCli(entry, repoDir, 'audit-overview');
  log(`${entry.name}: audit-overview (warm)`);
  const warm = runCli(entry, repoDir, 'audit-overview');
  log(`${entry.name}: dead-exports`);
  const dead = runCli(entry, repoDir, 'dead-exports');

  writeJson(files[0], warm.parsed);
  writeJson(files[1], dead.parsed);
  const health = {
    ...healthOf(warm.parsed, cold.ms, warm.ms, dirBytes(cacheDirFor(entry))),
    coldWarmDiff: coldWarmDiff(cold.parsed, warm.parsed),
    deadExports: deadExportCounts(dead.parsed),
  };
  writeJson(files[2], health);
  writeMarker(entry, { commit: entry.commit, srcMtimeMs: srcMtime, cliRunAt: new Date().toISOString() });
  log(`${entry.name}: cold ${cold.ms}ms / warm ${warm.ms}ms, coverage ${health.coverageRatio}, unresolved ${health.unresolvedCount}, dropped ${health.droppedCount}`);
  const mismatch = Object.keys(health.coldWarmDiff);
  if (mismatch.length) log(`${entry.name}: COLD/WARM MISMATCH on ${mismatch.join(', ')} — ${JSON.stringify(health.coldWarmDiff)}`);
}

// ---------------------------------------------------------------- coverage-pytest truth

const DUMP_GT_PY = `# generated by eval/run.js — port of test/eval_affected_tests.py ground_truth()
import collections, json, os, sys
import coverage

repo, cov_file, out_file = sys.argv[1], sys.argv[2], sys.argv[3]
data = coverage.Coverage(data_file=cov_file)
data.load()
d = data.get_data()
gt = collections.defaultdict(set)
ctx_map = collections.defaultdict(set)
for f in d.measured_files():
    rel = os.path.relpath(f, repo).replace('\\\\', '/')
    for contexts in (d.contexts_by_lineno(f) or {}).values():
        for ctx in contexts:
            parts = ctx.split('.') if ctx else []
            for i in range(len(parts), 0, -1):
                candidate = '/'.join(parts[:i]) + '.py'
                if os.path.exists(os.path.join(repo, candidate)):
                    gt[rel].add(candidate)
                    ctx_map[rel].add(ctx)
                    break
result = {
    'generatedAt': __import__('datetime').datetime.now().isoformat(timespec='seconds'),
    'method': 'coverage dynamic_context=test_function; test-function contexts collapsed to test files exactly like test/eval_affected_tests.py ground_truth()',
    'covFile': os.path.abspath(cov_file),
    'map': {k: sorted(v) for k, v in sorted(gt.items())},
    'contexts': {k: sorted(v) for k, v in sorted(ctx_map.items())},
}
with open(out_file, 'w', encoding='utf-8') as fh:
    json.dump(result, fh, indent=2, ensure_ascii=False)
print('gt files:', len(result['map']))
`;

function venvPython(venvDir) {
  return process.platform === 'win32' ? path.join(venvDir, 'Scripts', 'python.exe') : path.join(venvDir, 'bin', 'python');
}

function pytestCoverage(entry, repoDir, notes) {
  const { source, tests } = entry.affectedTests;
  const out = lib.outDir(entry);
  const covFile = path.join(out, 'coverage.data');
  const gtFile = path.join(out, 'gt.json');
  const logFile = path.join(out, 'pytest.log');
  const steps = () => readMarker(entry).steps || {};
  const markStep = (name, value) => writeMarker(entry, { steps: { ...steps(), [name]: value } });
  const pending = (reason) => {
    setStatus(entry, 'affected-tests', 'pending', { reason });
    log(`${entry.name}: affected-tests pending — ${reason}`);
  };

  if (!FORCE && steps().coverage === entry.commit && fs.existsSync(covFile) && fs.existsSync(gtFile)) {
    log(`${entry.name}: coverage truth cached, skip (use --force to re-run)`);
    setStatus(entry, 'affected-tests', 'ok', { truth: 'gt.json', cached: true });
    return;
  }

  const py = findPython();
  if (!py) return pending('python not found on PATH');

  const venvDir = path.join(VENVS_DIR, entry.name);
  const vpy = venvPython(venvDir);
  if (!fs.existsSync(vpy)) {
    log(`${entry.name}: creating isolated venv at ${venvDir}`);
    const r = sh(py[0], [...py.slice(1), '-m', 'venv', venvDir]);
    if (r.status !== 0) return pending(`venv creation failed: ${tail(r.stderr, 400)}`);
  }
  if (sh(vpy, ['-c', 'import pytest, coverage']).status !== 0) {
    log(`${entry.name}: pip install pytest coverage`);
    const r = sh(vpy, ['-m', 'pip', 'install', '--disable-pip-version-check', '-q', 'pytest', 'coverage']);
    if (r.status !== 0) return pending(`pip install pytest coverage failed: ${tail(r.stderr, 600)}`);
  }
  // editable install points at the clone path, so the path is part of the key
  const depsKey = `${entry.commit}@${repoDir}`;
  if (steps().deps !== depsKey) {
    log(`${entry.name}: pip install -e <clone> (into venv)`);
    const r = sh(vpy, ['-m', 'pip', 'install', '--disable-pip-version-check', '-q', '-e', repoDir]);
    if (r.status !== 0) return pending(`pip install -e failed: ${tail(r.stderr, 600)}`);
    markStep('deps', depsKey);
  }

  if (!FORCE && steps().pytest === entry.commit && fs.existsSync(covFile) && fs.existsSync(logFile)) {
    log(`${entry.name}: pytest run cached, skip`);
  } else {
    const rcfile = path.join(out, 'covrc');
    fs.writeFileSync(
      rcfile,
      `[run]\nsource = ${lib.toPosix(path.join(repoDir, source))}\ndynamic_context = test_function\ndata_file = ${lib.toPosix(covFile)}\n`
    );
    fs.rmSync(covFile, { force: true });
    const args = ['-m', 'coverage', 'run', `--rcfile=${rcfile}`, '-m', 'pytest', '-q', '-p', 'no:cacheprovider', '-p', 'no:cov', tests];
    log(`${entry.name}: coverage + pytest (typer takes ~20 min on Windows)`);
    const r = sh(vpy, args, { cwd: repoDir, timeout: PYTEST_TIMEOUT_MS });
    fs.writeFileSync(logFile, `$ ${vpy} ${args.join(' ')}\n${r.stdout || ''}\n${r.stderr || ''}`);
    // exit 1 = some tests failed: still a completed run, truth comes from coverage data
    if ((r.status !== 0 && r.status !== 1) || !fs.existsSync(covFile)) {
      return pending(`coverage/pytest run failed (status ${r.status}); see ${path.relative(ROOT, logFile)}`);
    }
    if (r.status === 1) notes.push(`${entry.name}: pytest exit 1 (some tests failed) — accepted, truth = coverage data`);
    markStep('pytest', entry.commit);
  }

  const dumpScript = path.join(out, 'dump_gt.py');
  fs.writeFileSync(dumpScript, DUMP_GT_PY);
  const g = sh(vpy, [dumpScript, repoDir, covFile, gtFile]);
  if (g.status !== 0 || !fs.existsSync(gtFile)) return pending(`gt dump failed: ${tail(g.stderr, 600)}`);

  markStep('coverage', entry.commit);
  setStatus(entry, 'affected-tests', 'ok', { truth: 'gt.json' });
  log(`${entry.name}: coverage ground truth ready (gt.json)`);
}

// ---------------------------------------------------------------- main

function evalRepo(entry, srcMtime, notes) {
  const repoDir = ensureRepo(entry);
  runCliSteps(entry, repoDir, srcMtime);
  setStatus(entry, 'health', 'ok', { truth: 'health.json' });
  if (entry.metrics.includes('dead-code')) setStatus(entry, 'dead-code', 'ok', { findings: 'dead-exports.json' });

  if (!entry.metrics.includes('affected-tests')) return;
  if (entry.affectedTests.method === 'coverage-pytest') {
    pytestCoverage(entry, repoDir, notes);
    return;
  }
  const st = (readJson(path.join(lib.outDir(entry), 'status.json'), {}).metrics || {})['affected-tests'];
  if (!st || st.status !== 'ok') {
    setStatus(entry, 'affected-tests', 'pending', {
      reason: `fault-injection truth not generated; run \`node eval/inject-fault.js ${entry.name}\` (expensive)`,
    });
  }
}

function main() {
  if (!fs.existsSync(CLI)) throw new Error(`cli.js not found: ${CLI}`);
  const corpus = lib.loadCorpus();
  const selected = lib.selectRepos(corpus, argv);
  const srcMtime = newestMtime(path.join(ROOT, 'src'));
  const notes = [];
  const failed = [];

  for (const entry of selected) {
    log(`=== ${entry.lang}/${entry.name} @ ${entry.commit} (heldOut=${entry.heldOut}) ===`);
    try {
      evalRepo(entry, srcMtime, notes);
    } catch (err) {
      console.error(`[eval] ${entry.name}: ${err.message}`);
      setStatus(entry, 'health', 'error', { reason: err.message.split('\n')[0] });
      failed.push(entry.name);
    }
  }

  for (const n of notes) log(`note: ${n}`);
  if (failed.length) {
    console.error(`[eval] ${failed.length} repo(s) failed: ${failed.join(', ')}`);
    process.exit(1);
  }
  log('done. next: node eval/score.js');
}

main();
