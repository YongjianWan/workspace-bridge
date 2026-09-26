#!/usr/bin/env node
/**
 * Fault-injection ground truth generator (EXPENSIVE — explicit flag only).
 *
 * Usage:
 *   node eval/inject-fault.js <repo>      # repo = spring-petclinic | vitesse
 *
 * For each sampled file in corpus.json faultInjection.files:
 *   1. back up the file
 *   2. inject a runtime fault as the first executable statement:
 *        Java  -> static initializer `static { throw new RuntimeException("wb-eval-fault"); }`
 *                 inserted right after the first class declaration (CHOOSEN over a
 *                 deliberate syntax error: a compile error fails the whole module's
 *                 test run degenerately — every test "affected" carries no signal;
 *                 a runtime class-init fault fails exactly the tests that touch the class)
 *        TS    -> `throw new Error('wb-eval-fault');` prepended at line 1
 *        Vue   -> same throw inserted right after the first <script ...> tag
 *   3. run the repo's test suite (petclinic: mvn -B test; vitesse: pnpm exec vitest run)
 *   4. collect failing tests -> ground truth for that file
 *   5. restore the file (always, even on crash)
 *
 * Writes eval/truth/out/<repo>/affected-tests-truth.json and flips
 * status.json metrics["affected-tests"] to ok. Missing JDK/maven/pnpm =>
 * prints `pending: <reason>` and exits 0 without faking anything.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const EVAL_DIR = __dirname;
const ROOT = path.resolve(EVAL_DIR, '..');
const TRUTH = path.join(EVAL_DIR, 'truth');
const REPOS_DIR = path.join(TRUTH, 'repos');
const OUT_DIR = path.join(TRUTH, 'out');
const corpus = JSON.parse(fs.readFileSync(path.join(EVAL_DIR, 'corpus.json'), 'utf8'));

const FAULT_JAVA = 'static { throw new RuntimeException("wb-eval-fault"); }';
const FAULT_TS = "throw new Error('wb-eval-fault');";

const log = (msg) => console.log(`[inject-fault] ${msg}`);
const pendingExit = (reason) => {
  console.log(`pending: ${reason}`);
  process.exit(0);
};

function sh(cmd, args, opts = {}) {
  let command = cmd;
  let argv = args;
  if (process.platform === 'win32' && (cmd === 'pnpm' || cmd === 'mvn')) {
    // .cmd shims need the shell; pass one pre-joined string (no args+shell, DEP0190)
    command = [cmd, ...args].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ');
    argv = [];
  }
  const r = spawnSync(command, argv, {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    shell: process.platform === 'win32' && (cmd === 'pnpm' || cmd === 'mvn'),
    ...opts,
  });
  if (r.error) return { status: -1, stdout: '', stderr: String(r.error.message) };
  return r;
}

function toolAvailable(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', shell: process.platform === 'win32' });
  if (r.error) return false;
  return r.status === 0;
}

// ---------------------------------------------------------------- injection

function injectJava(src) {
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(public\s+|final\s+|abstract\s+|static\s+)*class\s+\w+[^{]*\{\s*$/.test(lines[i])) {
      lines.splice(i + 1, 0, `        ${FAULT_JAVA}`);
      return lines.join('\n');
    }
  }
  return null;
}

function injectTs(src) {
  return `${FAULT_TS}\n${src}`;
}

function injectVue(src) {
  const m = src.match(/<script[^>]*>/);
  if (!m) return null;
  const idx = m.index + m[0].length;
  return `${src.slice(0, idx)}\n${FAULT_TS}${src.slice(idx)}`;
}

function inject(file, src) {
  if (file.endsWith('.java')) return injectJava(src);
  if (file.endsWith('.vue')) return injectVue(src);
  if (/\.[cm]?[jt]sx?$/.test(file)) return injectTs(src);
  return null;
}

// ---------------------------------------------------------------- suite runners

function parseSurefire(dir) {
  // -> [{id: 'pkg.Class#method', className: 'pkg.Class'}]
  const reportDir = path.join(dir, 'target', 'surefire-reports');
  const failures = [];
  if (!fs.existsSync(reportDir)) return failures;
  for (const f of fs.readdirSync(reportDir)) {
    if (!f.endsWith('.xml')) continue;
    const xml = fs.readFileSync(path.join(reportDir, f), 'utf8');
    const re = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
    let m;
    while ((m = re.exec(xml))) {
      const body = m[2] || '';
      if (!/<failure\b/.test(body) && !/<error\b/.test(body)) continue;
      const cls = /classname="([^"]+)"/.exec(m[1]);
      const name = /name="([^"]+)"/.exec(m[1]);
      if (cls) failures.push({ id: `${cls[1]}#${name ? name[1] : '?'}`, className: cls[1] });
    }
  }
  return failures;
}

function findJavaTestFile(dir, className) {
  const simple = className.split('.').pop();
  const root = path.join(dir, 'src', 'test');
  let hit = null;
  const walk = (d) => {
    if (hit) return;
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) walk(path.join(d, e.name));
      else if (e.name === `${simple}.java`) {
        hit = path.relative(dir, path.join(d, e.name)).replace(/\\/g, '/');
        return;
      }
    }
  };
  walk(root);
  return hit;
}

function runMavenTests(dir) {
  // clean old reports so parse reflects this run only
  fs.rmSync(path.join(dir, 'target', 'surefire-reports'), { recursive: true, force: true });
  const r = sh('mvn', ['-B', '-q', 'test'], { cwd: dir, timeout: 30 * 60 * 1000 });
  return { status: r.status, failures: parseSurefire(dir), stderr: r.stderr };
}

function parseVitestJson(raw) {
  // json reporter output: { testResults: [{ name, status, assertionResults: [{fullName, status}] }] }
  const start = raw.indexOf('{');
  if (start < 0) return null;
  try {
    const data = JSON.parse(raw.slice(start));
    const failed = [];
    for (const suite of data.testResults || []) {
      for (const a of suite.assertionResults || []) {
        if (a.status === 'failed') failed.push({ id: `${suite.name} > ${a.fullName || a.title || ''}`, file: suite.name });
      }
      if (suite.status === 'failed' && (suite.assertionResults || []).length === 0) {
        failed.push({ id: suite.name, file: suite.name });
      }
    }
    return failed;
  } catch {
    return null;
  }
}

function runVitest(dir, outFile) {
  fs.rmSync(outFile, { force: true });
  const r = sh('pnpm', ['exec', 'vitest', 'run', '--reporter=json', `--outputFile=${outFile}`], {
    cwd: dir,
    timeout: 15 * 60 * 1000,
  });
  if (fs.existsSync(outFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(outFile, 'utf8'));
      const failed = [];
      for (const suite of data.testResults || []) {
        for (const a of suite.assertionResults || []) {
          if (a.status === 'failed') failed.push({ id: `${path.basename(suite.name)} > ${a.fullName || a.title || ''}`, file: suite.name });
        }
        if (suite.status === 'failed' && (suite.assertionResults || []).length === 0) failed.push({ id: suite.name, file: suite.name });
      }
      return { status: r.status, failures: failed, stderr: r.stderr };
    } catch (err) {
      return { status: r.status, failures: null, parseError: String(err), stderr: r.stderr };
    }
  }
  const parsed = parseVitestJson(`${r.stdout || ''}`);
  return { status: r.status, failures: parsed, parseError: parsed ? null : 'no outputFile and stdout not parseable', stderr: r.stderr };
}

// ---------------------------------------------------------------- main

function setStatus(entry, metric, status, extra = {}) {
  const file = path.join(OUT_DIR, entry.name, 'status.json');
  let cur = null;
  try {
    cur = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {}
  cur = cur || { repo: entry.name, metrics: {} };
  cur.metrics = cur.metrics || {};
  cur.commit = entry.commit;
  cur.updatedAt = new Date().toISOString();
  cur.metrics[metric] = { status, ...extra };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(cur, null, 2)}\n`);
}

function main() {
  const name = process.argv[2];
  if (!name) {
    console.error('usage: node eval/inject-fault.js <repo>');
    process.exit(2);
  }
  const entry = corpus.repos.find((r) => r.name === name);
  if (!entry || !entry.faultInjection) {
    console.error(`[inject-fault] no faultInjection config for "${name}" in corpus.json`);
    process.exit(2);
  }
  const dir = path.join(REPOS_DIR, name);
  if (!fs.existsSync(path.join(dir, '.git'))) {
    pendingExit(`clone missing for ${name}; run \`node eval/run.js ${name}\` first`);
  }

  // toolchain gates — never fake numbers
  if (name === 'spring-petclinic') {
    if (!toolAvailable('mvn', ['-v'])) pendingExit('mvn not found on PATH (spring-petclinic affected-tests truth unavailable)');
    if (!toolAvailable('java', ['-version'])) pendingExit('java not found on PATH (spring-petclinic affected-tests truth unavailable)');
  }
  if (name === 'vitesse') {
    if (!toolAvailable('pnpm', ['-v'])) pendingExit('pnpm not found on PATH (vitesse affected-tests truth unavailable)');
  }

  // start from a clean pinned tree
  spawnSync('git', ['-C', dir, 'checkout', '-f', '--detach', entry.commit], { encoding: 'utf8' });

  const files = entry.faultInjection.files;
  const outDir = path.join(OUT_DIR, name);
  fs.mkdirSync(outDir, { recursive: true });
  const vitestOut = path.join(outDir, 'vitest-report.json');

  let baseline; // assigned in both branches below (pendingExit terminates otherwise)
  if (name === 'spring-petclinic') {
    log('baseline: mvn -B test (first run may download dependencies)');
    const b = runMavenTests(dir);
    if (b.failures === null) pendingExit('mvn baseline run produced no parseable surefire reports');
    baseline = b.failures;
    log(`baseline failures: ${baseline.length}`);
  } else {
    if (!fs.existsSync(path.join(dir, 'node_modules'))) {
      log('pnpm install --frozen-lockfile (one-time)');
      const r = sh('pnpm', ['install', '--frozen-lockfile'], { cwd: dir, timeout: 20 * 60 * 1000 });
      if (r.status !== 0) pendingExit(`pnpm install failed: ${String(r.stderr || '').slice(-400)}`);
    }
    log('baseline: vitest run');
    const b = runVitest(dir, vitestOut);
    if (!b.failures) pendingExit(`baseline vitest run unparseable: ${b.parseError || b.stderr}`);
    baseline = b.failures;
    log(`baseline failures: ${baseline.length}`);
  }
  const baselineIds = new Set(baseline.map((f) => f.id));

  const results = [];
  for (const rel of files) {
    const abs = path.join(dir, rel);
    const original = fs.readFileSync(abs, 'utf8');
    const injected = inject(rel, original);
    if (!injected) {
      log(`${rel}: no injection point found — skipped`);
      results.push({ file: rel, error: 'no injection point' });
      continue;
    }
    log(`${rel}: injecting fault + running suite...`);
    let run;
    try {
      fs.writeFileSync(abs, injected);
      run = name === 'spring-petclinic' ? runMavenTests(dir) : runVitest(dir, vitestOut);
    } catch (err) {
      results.push({ file: rel, error: String(err) });
      continue;
    } finally {
      fs.writeFileSync(abs, original);
    }
    if (!run.failures) {
      results.push({ file: rel, error: `suite run unparseable: ${run.parseError || String(run.stderr || '').slice(-300)}` });
      continue;
    }
    const fresh = run.failures.filter((f) => !baselineIds.has(f.id));
    const failingTestFiles = new Set();
    for (const f of fresh) {
      if (f.file) failingTestFiles.add(f.file);
      else if (name === 'spring-petclinic') {
        const tf = findJavaTestFile(dir, f.className);
        if (tf) failingTestFiles.add(tf);
      }
    }
    results.push({
      file: rel,
      failingTests: fresh.map((f) => f.id),
      failingTestFiles: [...failingTestFiles].sort(),
    });
    log(`${rel}: ${fresh.length} failing tests`);
  }

  // safety: restore the whole tree
  spawnSync('git', ['-C', dir, 'checkout', '-f', '--', '.'], { encoding: 'utf8' });

  const truth = {
    repo: name,
    commit: entry.commit,
    generatedAt: new Date().toISOString(),
    method:
      name === 'spring-petclinic'
        ? 'static-initializer runtime fault in first class; failing surefire tests (minus baseline) = ground truth; id->file via src/test/**/<Class>.java'
        : "top-of-module runtime throw (line 1 for .ts, after <script> for .vue); failing vitest assertions (minus baseline) = ground truth",
    baselineFailures: baseline.map((f) => f.id),
    files: results,
  };
  const truthFile = path.join(outDir, 'affected-tests-truth.json');
  fs.writeFileSync(truthFile, `${JSON.stringify(truth, null, 2)}\n`);
  const okFiles = results.filter((r) => !r.error).length;
  setStatus(entry, 'affected-tests', okFiles > 0 ? 'ok' : 'pending', {
    truth: 'affected-tests-truth.json',
    ...(okFiles > 0 ? {} : { reason: 'all injection runs errored' }),
  });
  log(`done: ${okFiles}/${results.length} files scored -> ${path.relative(ROOT, truthFile)}`);
}

main();
