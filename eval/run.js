#!/usr/bin/env node
/**
 * workspace-bridge evaluation runner.
 *
 * Usage:
 *   node eval/run.js [repo ...] [--force]
 *
 * For each corpus repo (default: all):
 *   1. ensure a clone exists at eval/truth/repos/<name> pinned to corpus commit
 *   2. run the workspace-bridge CLI (repo's own cli.js, absolute path):
 *        dead-exports  -> eval/truth/out/<name>/dead-exports.json
 *        audit-overview -> eval/truth/out/<name>/audit-overview.json
 *      (both steps are cached: skipped when output exists AND target commit +
 *       src mtime are unchanged; --force re-runs)
 *   3. typer only — coverage ground truth (report §5.2 methodology):
 *      isolated venv, independent coverage rcfile (typer's own config is
 *      parallel-mode and conflicts — rcfile is mandatory), then
 *        python -m coverage run --rcfile=... -m pytest -q -p no:cacheprovider -p no:cov tests
 *      inside the clone, then dump per-file -> test-function map to gt.json.
 *
 * Each repo gets eval/truth/out/<name>/status.json recording which metrics
 * have truth (ok) vs pending (with reason). eval/score.js consumes these.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const EVAL_DIR = __dirname;
const ROOT = path.resolve(EVAL_DIR, '..');
const CLI = path.join(ROOT, 'cli.js');
const TRUTH = path.join(EVAL_DIR, 'truth');
const REPOS_DIR = path.join(TRUTH, 'repos');
const OUT_DIR = path.join(TRUTH, 'out');
const corpus = JSON.parse(fs.readFileSync(path.join(EVAL_DIR, 'corpus.json'), 'utf8'));

const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const names = argv.filter((a) => !a.startsWith('--'));
const selected = names.length
  ? names.map((n) => {
      const entry = corpus.repos.find((r) => r.name === n);
      if (!entry) {
        console.error(`[eval] unknown repo "${n}" (corpus has: ${corpus.repos.map((r) => r.name).join(', ')})`);
        process.exit(2);
      }
      return entry;
    })
  : corpus.repos;

const log = (msg) => console.log(`[eval] ${msg}`);
const tail = (s, n = 1200) => String(s || '').slice(-n);

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
  if (r.error) {
    return { status: -1, stdout: '', stderr: r.error.code === 'ENOENT' ? `${cmd}: command not found` : String(r.error.message) };
  }
  return r;
}

function shOk(cmd, args, opts = {}) {
  const r = sh(cmd, args, opts);
  if (r.status !== 0) {
    console.error(`[eval] FAILED: ${cmd} ${args.join(' ')}`);
    console.error(`[eval] status=${r.status}\n${tail(r.stdout)}\n${tail(r.stderr)}`);
    process.exit(1);
  }
  return r;
}

function findPython() {
  for (const cand of [['python'], ['python3'], ['py', '-3']]) {
    const r = sh(cand[0], [...cand.slice(1), '--version']);
    if (r.status === 0) return cand;
  }
  return null;
}

function newestMtime(dir) {
  let max = 0;
  const walk = (d) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        try {
          const st = fs.statSync(p);
          if (st.mtimeMs > max) max = st.mtimeMs;
        } catch {}
      }
    }
  };
  walk(dir);
  return max;
}

// ---------------------------------------------------------------- clone

function ensureRepo(entry) {
  const dir = path.join(REPOS_DIR, entry.name);
  if (!fs.existsSync(path.join(dir, '.git'))) {
    fs.mkdirSync(REPOS_DIR, { recursive: true });
    fs.rmSync(dir, { recursive: true, force: true });
    log(`${entry.name}: cloning ${entry.url}`);
    shOk('git', ['clone', entry.url, dir]);
  }
  const git = (...args) => sh('git', args, { cwd: dir });
  if (git('cat-file', '-e', `${entry.commit}^{commit}`).status !== 0) {
    log(`${entry.name}: fetching to reach commit ${entry.commit}`);
    shOk('git', ['-C', dir, 'fetch', 'origin']);
  }
  const head = git('rev-parse', 'HEAD').stdout.trim();
  if (!head.startsWith(entry.commit)) {
    log(`${entry.name}: checking out ${entry.commit}`);
    // -f discards leftover edits (e.g. a previous interrupted fault injection)
    shOk('git', ['-C', dir, 'checkout', '-f', '--detach', entry.commit]);
  }
  const verify = git('rev-parse', 'HEAD').stdout.trim();
  if (!verify.startsWith(entry.commit)) {
    console.error(`[eval] ${entry.name}: HEAD ${verify} does not match pinned ${entry.commit}`);
    process.exit(1);
  }
  return dir;
}

// ---------------------------------------------------------------- status / marker

function outDirFor(name) {
  const d = path.join(OUT_DIR, name);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, obj) {
  fs.writeFileSync(file, `${JSON.stringify(obj, null, 2)}\n`);
}

function readMarker(outDir) {
  return readJson(path.join(outDir, 'marker.json'), {});
}

function writeMarker(outDir, patch) {
  const m = { ...readMarker(outDir), ...patch };
  writeJson(path.join(outDir, 'marker.json'), m);
  return m;
}

function setStatus(outDir, entry, metric, status, extra = {}) {
  const file = path.join(outDir, 'status.json');
  const cur = readJson(file, { repo: entry.name, metrics: {} });
  cur.repo = entry.name;
  cur.commit = entry.commit;
  cur.updatedAt = new Date().toISOString();
  cur.metrics = cur.metrics || {};
  cur.metrics[metric] = { status, ...extra };
  writeJson(file, cur);
  return cur;
}

// ---------------------------------------------------------------- CLI steps

function runCliStep(entry, repoDir, srcMtime, command, outFile) {
  const outDir = outDirFor(entry.name);
  const marker = readMarker(outDir);
  if (!FORCE && marker.commit === entry.commit && marker.srcMtimeMs === srcMtime && fs.existsSync(outFile)) {
    log(`${entry.name}: ${command} cached, skip (use --force to re-run)`);
    return;
  }
  log(`${entry.name}: node cli.js ${command} --cwd <clone> --json --quiet`);
  const r = spawnSync(process.execPath, [CLI, command, '--cwd', repoDir, '--json', '--quiet'], {
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  });
  if (r.status !== 0) {
    console.error(`[eval] ${entry.name}: ${command} failed (status ${r.status})`);
    console.error(tail(r.stdout));
    console.error(tail(r.stderr));
    process.exit(1);
  }
  let parsed;
  try {
    parsed = JSON.parse(r.stdout);
  } catch (err) {
    console.error(`[eval] ${entry.name}: ${command} produced unparseable JSON: ${tail(r.stdout, 300)}`);
    process.exit(1);
  }
  if (parsed.ok === false) {
    console.error(`[eval] ${entry.name}: ${command} returned ok=false: ${JSON.stringify(parsed.error || parsed).slice(0, 500)}`);
    process.exit(1);
  }
  writeJson(outFile, parsed);
  writeMarker(outDir, {
    commit: entry.commit,
    srcMtimeMs: srcMtime,
    steps: { ...(readMarker(outDir).steps || {}), [command]: new Date().toISOString() },
  });
}

// ---------------------------------------------------------------- typer coverage truth

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

function typerCoverage(entry, repoDir, outDir, notes) {
  const covFile = path.join(outDir, 'typer.cov');
  const gtFile = path.join(outDir, 'gt.json');
  const marker = readMarker(outDir);
  const pending = (reason) => {
    setStatus(outDir, entry, 'affected-tests', 'pending', { reason, notes: notes.slice() });
    log(`typer: affected-tests pending — ${reason}`);
  };

  if (marker.steps && marker.steps.coverage === entry.commit && fs.existsSync(covFile) && fs.existsSync(gtFile) && !FORCE) {
    log('typer: coverage truth cached, skip (use --force to re-run)');
    setStatus(outDir, entry, 'affected-tests', 'ok', { truth: 'gt.json', coverage: 'typer.cov', cached: true });
    return;
  }

  const py = findPython();
  if (!py) return pending('python not found on PATH');

  const venvDir = path.join(TRUTH, 'venv-typer');
  const vpy = venvPython(venvDir);
  if (!fs.existsSync(vpy)) {
    log(`typer: creating isolated venv at ${venvDir}`);
    const r = sh(py[0], [...py.slice(1), '-m', 'venv', venvDir]);
    if (r.status !== 0) return pending(`venv creation failed: ${tail(r.stderr, 400)}`);
  }

  // pytest + coverage inside the venv; install if missing
  if (sh(vpy, ['-c', 'import pytest, coverage']).status !== 0) {
    notes.push('typer: pip install pytest coverage (inside eval/truth/venv-typer)');
    log('typer: pip install pytest coverage');
    const r = sh(vpy, ['-m', 'pip', 'install', '--disable-pip-version-check', '-q', 'pytest', 'coverage']);
    if (r.status !== 0) return pending(`pip install pytest coverage failed: ${tail(r.stderr, 600)}`);
  }

  // typer deps (report §5.2 step 1: pip install -e <typer>) — cached via venv marker
  if (!(readMarker(outDir).steps || {}).typerDeps) {
    log('typer: pip install -e <typer-clone> (into venv)');
    const r = sh(vpy, ['-m', 'pip', 'install', '--disable-pip-version-check', '-q', '-e', repoDir]);
    if (r.status !== 0) return pending(`pip install -e typer failed: ${tail(r.stderr, 600)}`);
    writeMarker(outDir, { steps: { ...(readMarker(outDir).steps || {}), typerDeps: entry.commit } });
    notes.push('typer: pip install -e <clone> (into eval venv)');
  }

  // independent rcfile — mandatory: typer's own [tool.coverage.run] is parallel mode
  const rcfile = path.join(outDir, 'covrc');
  const logFile = path.join(outDir, 'pytest.log');
  const stepsNow = () => readMarker(outDir).steps || {};

  // pytest step, cached on its own: status 1 = test failures is a *completed*
  // run (ground truth comes from coverage data, not from pass/fail)
  if (stepsNow().pytest === entry.commit && fs.existsSync(covFile) && fs.existsSync(logFile) && !FORCE) {
    log('typer: pytest run cached, skip');
  } else {
    fs.writeFileSync(
      rcfile,
      `[run]\nsource = ${path.join(repoDir, 'typer').replace(/\\/g, '/')}\ndynamic_context = test_function\ndata_file = ${covFile.replace(/\\/g, '/')}\n`
    );
    fs.rmSync(covFile, { force: true });

    log('typer: coverage + pytest (~20 min on Windows)');
    const r = sh(
      vpy,
      ['-m', 'coverage', 'run', `--rcfile=${rcfile}`, '-m', 'pytest', '-q', '-p', 'no:cacheprovider', '-p', 'no:cov', 'tests'],
      { cwd: repoDir, timeout: 45 * 60 * 1000 }
    );
    fs.writeFileSync(logFile, `$ ${vpy} -m coverage run --rcfile=${rcfile} -m pytest -q -p no:cacheprovider -p no:cov tests\n${r.stdout || ''}\n${r.stderr || ''}`);
    if ((r.status !== 0 && r.status !== 1) || !fs.existsSync(covFile)) {
      return pending(`coverage/pytest run failed (status ${r.status}); see eval/truth/out/typer/pytest.log`);
    }
    if (r.status === 1) notes.push('typer: pytest exit 1 (some tests failed) — accepted; ground truth = coverage data regardless of pass/fail');
    writeMarker(outDir, { steps: { ...stepsNow(), pytest: entry.commit } });
  }

  // per-file -> test-function map (truth JSON)
  const dumpScript = path.join(outDir, 'dump_gt.py');
  fs.writeFileSync(dumpScript, DUMP_GT_PY);
  const g = sh(vpy, [dumpScript, repoDir, covFile, gtFile]);
  if (g.status !== 0 || !fs.existsSync(gtFile)) {
    return pending(`gt dump failed: ${tail(g.stderr, 600)}`);
  }

  writeMarker(outDir, { steps: { ...(readMarker(outDir).steps || {}), coverage: entry.commit } });
  setStatus(outDir, entry, 'affected-tests', 'ok', { truth: 'gt.json', coverage: 'typer.cov' });
  log('typer: coverage ground truth ready (gt.json)');
}

// ---------------------------------------------------------------- main

function main() {
  if (!fs.existsSync(CLI)) {
    console.error(`[eval] cli.js not found: ${CLI}`);
    process.exit(2);
  }
  const srcMtime = newestMtime(path.join(ROOT, 'src'));
  const notes = [];

  for (const entry of selected) {
    log(`=== ${entry.name} @ ${entry.commit} (heldOut=${entry.heldOut}) ===`);
    const repoDir = ensureRepo(entry);
    const outDir = outDirFor(entry.name);

    runCliStep(entry, repoDir, srcMtime, 'dead-exports', path.join(outDir, 'dead-exports.json'));
    runCliStep(entry, repoDir, srcMtime, 'audit-overview', path.join(outDir, 'audit-overview.json'));
    setStatus(outDir, entry, 'dead-code', 'ok', { findings: 'dead-exports.json' });

    if (entry.metrics.includes('affected-tests') && entry.name === 'typer') {
      typerCoverage(entry, repoDir, outDir, notes);
    } else if (entry.metrics.includes('affected-tests')) {
      const cur = readJson(path.join(outDir, 'status.json'), { metrics: {} });
      if (!cur.metrics || !cur.metrics['affected-tests'] || cur.metrics['affected-tests'].status !== 'ok') {
        setStatus(outDir, entry, 'affected-tests', 'pending', {
          reason: `fault-injection truth not generated; run \`node eval/inject-fault.js ${entry.name}\` explicitly (expensive)`,
        });
      }
    }
  }

  for (const n of notes) log(`note: ${n}`);
  log('done. next: node eval/score.js');
}

main();
