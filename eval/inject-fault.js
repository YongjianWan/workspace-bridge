#!/usr/bin/env node
/**
 * Fault-injection ground truth generator (EXPENSIVE — run explicitly).
 *
 * Usage:
 *   node eval/inject-fault.js <repo>
 *
 * Works on corpus repos whose affectedTests.method is "fault-injection".
 * Target files: affectedTests.files, or else `sample` files picked evenly
 * from the sorted non-test source files (optionally under sampleDir) —
 * deterministic for a pinned commit.
 *
 * For each target file:
 *   1. inject a *runtime* fault (never a syntax error: a compile failure fails
 *      every test at once and carries no signal)
 *        maven  — `static { if (true) throw ... }` after the first class declaration
 *                 (the `if (true)` is required: javac rejects an initializer that
 *                 cannot complete normally)
 *        vitest — `throw` at module top (.ts/.js) or right after <script> (.vue)
 *        go     — `panic(...)` as the first statement of every top-level func
 *        cargo  — `panic!(...)` as the first statement of every non-const fn
 *                 outside #[cfg(test)]
 *   2. run the suite; tests failing now but not in the clean baseline = truth
 *   3. restore the file (always, plus `git checkout -f` at the end)
 * A run that stops compiling is recorded as an error for that file, not truth.
 *
 * Runner notes:
 *   go    — a panicking test aborts its whole test binary, so for every failed
 *           package each _test.go file is re-run on its own (`-run` with that
 *           file's Test/Example funcs); truth is file-level, which is what the
 *           scorer compares anyway.
 *   cargo — only integration tests (tests/**) have a test file of their own;
 *           failing inline unit tests and doc tests are kept as ids with no file.
 *
 * Writes eval/truth/out/<lang>/<name>/affected-tests-truth.json and flips
 * status.json metrics["affected-tests"] to ok. A missing toolchain prints
 * `pending: <reason>` and exits 0 — numbers are never faked.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const lib = require('./lib');

const { sh, toolAvailable, tail, toPosix, toRepoRel } = lib;

const FAULT_MSG = 'wb-eval-fault';
const SUITE_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_SAMPLE = 10;

const log = (msg) => console.log(`[inject-fault] ${msg}`);
const pendingExit = (reason) => {
  console.log(`pending: ${reason}`);
  process.exit(0);
};

// ---------------------------------------------------------------- injection

/** Insert `stmt` after every line matching `re`, until `stopAt(prevLine, line)` holds. */
function insertAfter(src, re, stmt, stopAt = () => false) {
  const lines = src.split('\n');
  const out = [];
  let hits = 0;
  let stopped = false;
  let prev = '';
  for (const line of lines) {
    out.push(line);
    if (stopAt(prev, line)) stopped = true;
    prev = line;
    if (!stopped && re.test(line)) {
      out.push(stmt);
      hits++;
    }
  }
  return hits ? out.join('\n') : null;
}

const JAVA_CLASS_RE = /^\s*(public\s+|final\s+|abstract\s+|static\s+)*class\s+\w+[^{]*\{\s*$/;
const GO_FUNC_RE = /^func\s.*\{\s*$/;
const RUST_FN_RE = /^\s*(pub(\([^)]*\))?\s+)?(async\s+)?(unsafe\s+)?(extern\s+"[^"]*"\s+)?fn\s+\w+.*\{\s*$/;
// Only an inline `#[cfg(test)] mod x {` ends the injectable part of a file;
// `#[cfg(test)] mod tests;` merely declares a separate file.
const rustInlineTestMod = (prev, line) => /^\s*#\[cfg\(test\)\]/.test(prev) && /^\s*(pub\s+)?mod\s+\w+\s*\{/.test(line);

function injectJava(src) {
  const lines = src.split('\n');
  const i = lines.findIndex((l) => JAVA_CLASS_RE.test(l));
  if (i < 0) return null;
  lines.splice(i + 1, 0, `        static { if (true) throw new RuntimeException("${FAULT_MSG}"); }`);
  return lines.join('\n');
}

function injectScript(file, src) {
  const stmt = `throw new Error('${FAULT_MSG}');`;
  if (!file.endsWith('.vue')) return `${stmt}\n${src}`;
  const m = src.match(/<script[^>]*>/);
  if (!m) return null;
  const idx = m.index + m[0].length;
  return `${src.slice(0, idx)}\n${stmt}${src.slice(idx)}`;
}

// ---------------------------------------------------------------- runners
//
// run(dir, ctx) -> { failing: [{id, file|null}] } | { error }

function parseSurefire(dir) {
  const reportDir = path.join(dir, 'target', 'surefire-reports');
  if (!fs.existsSync(reportDir)) return null;
  const failing = [];
  const testcaseRe = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
  for (const f of fs.readdirSync(reportDir)) {
    if (!f.endsWith('.xml')) continue;
    const xml = fs.readFileSync(path.join(reportDir, f), 'utf8');
    let m;
    while ((m = testcaseRe.exec(xml))) {
      if (!/<(failure|error)\b/.test(m[2] || '')) continue;
      const cls = /classname="([^"]+)"/.exec(m[1]);
      const name = /name="([^"]+)"/.exec(m[1]);
      if (cls) failing.push({ id: `${cls[1]}#${name ? name[1] : '?'}`, className: cls[1] });
    }
  }
  return failing;
}

function javaTestFile(dir, className) {
  const rel = `src/test/java/${className.replace(/\$.*$/, '').replace(/\./g, '/')}.java`;
  return fs.existsSync(path.join(dir, rel)) ? rel : null;
}

const maven = {
  tools: [['mvn', ['-v']], ['java', ['-version']]],
  isSource: (f) => f.includes('src/main/') && f.endsWith('.java'),
  isTest: lib.TEST_FILE_RULES.maven,
  inject: (file, src) => injectJava(src),
  run(dir) {
    fs.rmSync(path.join(dir, 'target', 'surefire-reports'), { recursive: true, force: true });
    // format/style plugins would reject the injected line before any test runs
    const r = sh('mvn', ['-B', '-q', 'test', '-Dspring-javaformat.skip=true', '-Dcheckstyle.skip=true'], {
      cwd: dir,
      timeout: SUITE_TIMEOUT_MS,
    });
    const failing = parseSurefire(dir);
    if (!failing) return { error: `no surefire reports (status ${r.status}): ${tail(r.stdout, 400)}` };
    return { failing: failing.map((f) => ({ id: f.id, file: javaTestFile(dir, f.className) })) };
  },
};

const vitest = {
  tools: [['pnpm', ['-v']]],
  isSource: (f) => /\.(vue|[cm]?[jt]sx?)$/.test(f) && !f.endsWith('.d.ts'),
  isTest: lib.TEST_FILE_RULES.vitest,
  inject: injectScript,
  prepare(dir) {
    if (fs.existsSync(path.join(dir, 'node_modules'))) return null;
    log('pnpm install --frozen-lockfile (one-time)');
    const r = sh('pnpm', ['install', '--frozen-lockfile'], { cwd: dir, timeout: SUITE_TIMEOUT_MS });
    return r.status === 0 ? null : `pnpm install failed: ${tail(r.stderr, 400)}`;
  },
  run(dir, ctx) {
    const report = path.join(ctx.outDir, 'vitest-report.json');
    fs.rmSync(report, { force: true });
    const r = sh('pnpm', ['exec', 'vitest', 'run', '--reporter=json', `--outputFile=${report}`], { cwd: dir, timeout: SUITE_TIMEOUT_MS });
    const data = lib.readJson(report, null);
    if (!data) return { error: `no vitest json report (status ${r.status}): ${tail(r.stderr, 400)}` };
    const failing = [];
    for (const suite of data.testResults || []) {
      const file = toRepoRel(dir, suite.name);
      const asserts = suite.assertionResults || [];
      for (const a of asserts) if (a.status === 'failed') failing.push({ id: `${file} > ${a.fullName || a.title || ''}`, file });
      if (suite.status === 'failed' && asserts.length === 0) failing.push({ id: file, file });
    }
    return { failing };
  },
};

const GO_TEST_FUNC_RE = /^func\s+((?:Test|Example)\w*)\s*\(/gm;

function goEvents(stdout) {
  const events = [];
  for (const line of String(stdout || '').split('\n')) {
    if (!line.startsWith('{')) continue;
    try {
      events.push(JSON.parse(line));
    } catch {}
  }
  return events;
}

const go = {
  tools: [['go', ['version']]],
  isSource: (f) => f.endsWith('.go') && !f.endsWith('_test.go'),
  isTest: lib.TEST_FILE_RULES.go,
  inject: (file, src) => insertAfter(src, GO_FUNC_RE, `\tpanic("${FAULT_MSG}")`),
  prepare(dir, ctx) {
    const r = sh('go', ['list', '-f', '{{.ImportPath}}|{{.Dir}}', './...'], { cwd: dir });
    if (r.status !== 0) return `go list failed: ${tail(r.stderr, 400)}`;
    ctx.pkgDirs = new Map(r.stdout.trim().split('\n').map((l) => l.trim().split('|')));
    return null;
  },
  run(dir, ctx) {
    const r = sh('go', ['test', '-json', '-count=1', './...'], { cwd: dir, timeout: SUITE_TIMEOUT_MS });
    const events = goEvents(r.stdout);
    if (events.some((e) => e.Action === 'build-fail')) return { error: `build failed: ${tail(r.stdout, 400)}` };
    const failedPkgs = new Set(events.filter((e) => e.Action === 'fail' && !e.Test).map((e) => e.Package));
    const failing = [];
    for (const pkg of failedPkgs) {
      const pkgDir = ctx.pkgDirs.get(pkg);
      if (!pkgDir) return { error: `failed package ${pkg} not in go list` };
      for (const name of fs.readdirSync(pkgDir).filter((f) => f.endsWith('_test.go')).sort()) {
        const funcs = [...fs.readFileSync(path.join(pkgDir, name), 'utf8').matchAll(GO_TEST_FUNC_RE)].map((m) => m[1]);
        if (!funcs.length) continue;
        const one = sh('go', ['test', '-count=1', '-run', `^(${funcs.join('|')})$`, pkg], { cwd: dir, timeout: SUITE_TIMEOUT_MS });
        if (one.status === 0) continue;
        const file = toRepoRel(dir, path.join(pkgDir, name));
        failing.push({ id: file, file });
      }
    }
    return { failing };
  },
};

const CARGO_RUNNING_RE = /^\s*Running (?:unittests )?(\S+)/;
const CARGO_DOCTESTS_RE = /^\s*Doc-tests (\S+)/;
const CARGO_FAILED_RE = /^test (\S+) \.\.\. FAILED/;

const cargo = {
  tools: [['cargo', ['--version']]],
  // src/tests.rs is the conventional home of a `#[cfg(test)] mod tests;`
  isSource: (f) => f.startsWith('src/') && f.endsWith('.rs') && !f.endsWith('/tests.rs'),
  isTest: lib.TEST_FILE_RULES.cargo,
  inject: (file, src) => insertAfter(src, RUST_FN_RE, `    panic!("${FAULT_MSG}");`, rustInlineTestMod),
  run(dir, ctx) {
    // cargo writes "Running <target>" headers to stderr and results to stdout;
    // one shared fd keeps their interleaving, which is how results map to targets
    const logFile = path.join(ctx.outDir, 'cargo-test.log');
    const fd = fs.openSync(logFile, 'w');
    try {
      sh('cargo', ['test', '--no-fail-fast', '--color', 'never'], { cwd: dir, timeout: SUITE_TIMEOUT_MS, stdio: ['ignore', fd, fd] });
    } finally {
      fs.closeSync(fd);
    }
    const text = fs.readFileSync(logFile, 'utf8');
    if (/error(\[E\d+\])?: /.test(text) && /could not compile/.test(text)) return { error: `compile failed: ${tail(text, 400)}` };
    const failing = [];
    let target = null;
    for (const line of text.split('\n')) {
      const run = CARGO_RUNNING_RE.exec(line);
      const doc = CARGO_DOCTESTS_RE.exec(line);
      if (run) target = toPosix(run[1]);
      else if (doc) target = `doctest:${doc[1]}`;
      const f = CARGO_FAILED_RE.exec(line);
      if (f) failing.push({ id: `${target} :: ${f[1]}`, file: target && cargo.isTest(target) ? target : null });
    }
    return { failing };
  },
};

const RUNNERS = { maven, vitest, go, cargo };

// ---------------------------------------------------------------- targets

function pickTargets(dir, cfg, runner) {
  if (cfg.files) return cfg.files;
  const listed = sh('git', ['-C', dir, 'ls-files', ...(cfg.sampleDir ? [cfg.sampleDir] : [])]).stdout.trim().split('\n');
  const pool = listed.map(toPosix).filter((f) => runner.isSource(f) && !runner.isTest(f)).sort();
  const n = Math.min(cfg.sample || DEFAULT_SAMPLE, pool.length);
  return Array.from({ length: n }, (_, i) => pool[Math.floor((i * pool.length) / n)]);
}

// ---------------------------------------------------------------- main

function main() {
  const name = process.argv[2];
  if (!name) {
    console.error('usage: node eval/inject-fault.js <repo>');
    process.exit(2);
  }
  const entry = lib.loadCorpus().repos.find((r) => r.name === name);
  const cfg = entry && entry.affectedTests;
  if (!cfg || cfg.method !== 'fault-injection') {
    console.error(`[inject-fault] "${name}" has no fault-injection config in corpus.json`);
    process.exit(2);
  }
  const runner = RUNNERS[cfg.runner];
  if (!runner) throw new Error(`corpus.json: unknown runner "${cfg.runner}" for ${name}`);

  const dir = lib.repoDir(entry);
  if (!fs.existsSync(path.join(dir, '.git'))) pendingExit(`clone missing for ${name}; run \`node eval/run.js ${name}\` first`);
  for (const [cmd, args] of runner.tools) {
    if (!toolAvailable(cmd, args)) pendingExit(`${cmd} not found on PATH (${name} affected-tests truth unavailable)`);
  }

  const git = (...args) => sh('git', ['-C', dir, ...args]);
  git('checkout', '-f', '--detach', entry.commit);
  const ctx = { outDir: lib.outDir(entry) };
  const prepError = runner.prepare ? runner.prepare(dir, ctx) : null;
  if (prepError) pendingExit(prepError);

  log(`baseline: ${cfg.runner} suite on the clean tree`);
  const base = runner.run(dir, ctx);
  if (base.error) pendingExit(`baseline run unusable: ${base.error}`);
  const baselineIds = new Set(base.failing.map((f) => f.id));
  log(`baseline failures: ${baselineIds.size}`);

  const targets = pickTargets(dir, cfg, runner);
  const results = [];
  for (const rel of targets) {
    const abs = path.join(dir, rel);
    const original = fs.readFileSync(abs, 'utf8');
    const injected = runner.inject(rel, original);
    if (!injected) {
      log(`${rel}: no injection point — skipped`);
      results.push({ file: rel, error: 'no injection point' });
      continue;
    }
    log(`${rel}: injecting fault + running suite...`);
    let run;
    try {
      fs.writeFileSync(abs, injected);
      run = runner.run(dir, ctx);
    } finally {
      fs.writeFileSync(abs, original);
    }
    if (run.error) {
      log(`${rel}: ${run.error.slice(0, 200)}`);
      results.push({ file: rel, error: run.error });
      continue;
    }
    const fresh = run.failing.filter((f) => !baselineIds.has(f.id));
    const failingTestFiles = [...new Set(fresh.map((f) => f.file).filter(Boolean))].sort();
    results.push({ file: rel, failingTests: fresh.map((f) => f.id), failingTestFiles });
    log(`${rel}: ${fresh.length} failing tests in ${failingTestFiles.length} test files`);
  }

  git('checkout', '-f', '--', '.');

  const truth = {
    repo: name,
    lang: entry.lang,
    commit: entry.commit,
    runner: cfg.runner,
    generatedAt: new Date().toISOString(),
    method: `runtime fault injection (${cfg.runner}); tests failing vs clean baseline = ground truth; see eval/inject-fault.js header`,
    baselineFailures: [...baselineIds],
    files: results,
  };
  const truthFile = path.join(ctx.outDir, 'affected-tests-truth.json');
  lib.writeJson(truthFile, truth);
  const okFiles = results.filter((r) => !r.error).length;
  lib.setStatus(entry, 'affected-tests', okFiles > 0 ? 'ok' : 'pending', {
    truth: 'affected-tests-truth.json',
    ...(okFiles > 0 ? {} : { reason: 'all injection runs errored' }),
  });
  log(`done: ${okFiles}/${results.length} files scored -> ${path.relative(lib.ROOT, truthFile)}`);
}

main();
