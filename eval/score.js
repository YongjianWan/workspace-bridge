#!/usr/bin/env node
/**
 * workspace-bridge evaluation scorer.
 *
 * Usage:
 *   node eval/score.js
 *
 * Reads eval/truth/out/* (run outputs + generated truth), eval/labels/*.jsonl,
 * and emits eval/scoreboard.json. Compares against eval/baseline.json when
 * present: a metric worse than baseline by > 0.05 prints FAIL, else PASS.
 * Always exits 0 — this scores, it does not gate.
 *
 * Metrics
 *   affected-tests (typer, coverage truth): micro precision/recall ported from
 *     test/eval_affected_tests.py into JS (ground truth = eval/truth/out/typer/
 *     gt.json, predictions = precomputed_impact in the clone's cache.db).
 *     The python file stays authoritative for methodology but is NOT shelled
 *     out on Windows: its os.path.relpath yields backslashes while its is_test
 *     filter checks `tests/` — all predictions get filtered out there (see
 *     eval/findings.md). The port normalizes separators on both sides and
 *     otherwise reproduces its loop exactly.
 *   affected-tests (fault-injection repos): only when eval/inject-fault.js has
 *     produced affected-tests-truth.json; predictions come from the CLI
 *     `affected-tests --file` per injected file. Otherwise pending.
 *   dead-code: precision = unlabeled findings / (unlabeled + labeled-FP still
 *     reported), split by the tool-reported confidence. Labels only mark known
 *     false positives (report §5.1); unlabeled findings are presumed true
 *     positives (the review did not verify them), so treat this as a relative
 *     metric. High-confidence precision should be >= 0.9 (interpretation rule).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const EVAL_DIR = __dirname;
const ROOT = path.resolve(EVAL_DIR, '..');
const CLI = path.join(ROOT, 'cli.js');
const TRUTH = path.join(EVAL_DIR, 'truth');
const OUT_DIR = path.join(TRUTH, 'out');
const REPOS_DIR = path.join(TRUTH, 'repos');
const corpus = JSON.parse(fs.readFileSync(path.join(EVAL_DIR, 'corpus.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const log = (msg) => console.log(`[eval] ${msg}`);
const readJson = (file, fb = null) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fb;
  }
};
const writeJson = (file, obj) => fs.writeFileSync(file, `${JSON.stringify(obj, null, 2)}\n`);

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
  if (r.error) return { status: -1, stdout: '', stderr: r.error.code === 'ENOENT' ? `${cmd}: command not found` : String(r.error.message) };
  return r;
}

function toRelForward(repoDir, p) {
  const s = String(p || '').replace(/\\/g, '/');
  if (path.isAbsolute(s)) {
    const rel = path.relative(repoDir, s).replace(/\\/g, '/');
    if (rel && !rel.startsWith('..')) return rel;
  }
  return s.replace(/^\.\//, '');
}

// precomputed_impact: file -> [{file, distance, ...}] straight from the clone's
// cache.db (populated by audit-overview, same source the python script reads).
function loadPredictions(repoDir) {
  const dbPath = path.join(repoDir, '.workspace-bridge', 'cache.db');
  if (!fs.existsSync(dbPath)) return null;
  let DatabaseSync;
  try {
    ({ DatabaseSync } = require('node:sqlite'));
  } catch {
    return null;
  }
  const select = (db) => db.prepare('SELECT file, affected_tests FROM precomputed_impact').all();
  let rows;
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    rows = select(db);
    db.close();
  } catch {
    try {
      const db = new DatabaseSync(dbPath);
      rows = select(db);
      db.close();
    } catch {
      return null;
    }
  }
  const preds = new Map();
  for (const r of rows) {
    const rel = toRelForward(repoDir, r.file);
    let list = [];
    try {
      list = JSON.parse(r.affected_tests || '[]');
    } catch {}
    const set = preds.get(rel) || new Set();
    for (const t of list) set.add(toRelForward(repoDir, typeof t === 'string' ? t : t.file));
    preds.set(rel, set);
  }
  return preds;
}

// ---------------------------------------------------------------- labels

function loadLabels(repoName) {
  const file = path.join(EVAL_DIR, 'labels', `${repoName}.jsonl`);
  if (!fs.existsSync(file)) return null;
  const rows = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim();
    if (t) rows.push(JSON.parse(t));
  }
  return rows;
}

function globToRegex(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++; // '**/' also absorbs the slash
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += /[.+^${}()|[\]\\]/.test(c) ? `\\${c}` : c;
  }
  return new RegExp(`^${re}$`);
}

function labelFileMatches(labelFile, findingFile) {
  const l = String(labelFile).replace(/\\/g, '/');
  const f = String(findingFile).replace(/\\/g, '/');
  if (l.includes('/')) {
    if (/[*?]/.test(l)) return globToRegex(l).test(f);
    return l === f;
  }
  // bare filename label (e.g. hexyl "lib.rs") matches by basename
  return f.split('/').pop() === l;
}

function labelMatches(label, finding) {
  return labelFileMatches(label.file, finding.file) && (label.symbol === '*' || label.symbol === finding.symbol);
}

// ---------------------------------------------------------------- dead-code

function normalizeFindingFile(repoDir, file) {
  let f = String(file || '').replace(/\\/g, '/');
  if (path.isAbsolute(f)) f = path.relative(repoDir, f).replace(/\\/g, '/');
  return f.replace(/^\.\//, '');
}

function scoreDeadCode(entry, outDir) {
  const findingsFile = path.join(outDir, 'dead-exports.json');
  const labels = loadLabels(entry.name);
  if (!fs.existsSync(findingsFile)) {
    return { status: 'pending', reason: 'dead-exports.json missing; run `node eval/run.js ' + entry.name + '`' };
  }
  if (!labels) return { status: 'pending', reason: `no labels file eval/labels/${entry.name}.jsonl` };

  const parsed = readJson(findingsFile, {});
  const repoDir = path.join(REPOS_DIR, entry.name);
  const findings = [];
  for (const item of parsed.deadExports || []) {
    const file = normalizeFindingFile(repoDir, item.file);
    for (const sym of item.exports || []) {
      findings.push({ file, symbol: sym, confidence: item.confidence || 'unknown' });
    }
  }

  const labelRows = labels.map((l) => ({ ...l, reported: false, reportedConfidence: null }));
  let tp = 0;
  let fp = 0;
  const byConf = {};
  for (const f of findings) {
    const hitIdx = labelRows.findIndex((l) => labelMatches(l, f));
    const isFp = hitIdx >= 0;
    if (isFp) {
      labelRows[hitIdx].reported = true;
      labelRows[hitIdx].reportedConfidence = f.confidence;
      fp++;
    } else tp++;
    const b = (byConf[f.confidence] = byConf[f.confidence] || { tp: 0, fp: 0 });
    if (isFp) b.fp++;
    else b.tp++;
  }

  const prec = (x) => (x.tp + x.fp > 0 ? round(x.tp / (x.tp + x.fp)) : null);
  const byConfidence = {};
  for (const [k, v] of Object.entries(byConf)) byConfidence[k] = { precision: prec(v), n: v.tp + v.fp, tp: v.tp, fp: v.fp };

  const labeledReported = labelRows.filter((l) => l.reported).length;
  return {
    status: 'ok',
    precision: prec({ tp, fp }),
    precisionHigh: byConfidence.high ? byConfidence.high.precision : null,
    precisionLow: byConfidence.low ? byConfidence.low.precision : null,
    byConfidence,
    n: findings.length,
    counts: {
      labeledRows: labelRows.length,
      labeledReported,
      labeledNotReported: labelRows.length - labeledReported,
      unlabeledFindings: tp,
      labeledFindings: fp,
    },
    labeledRows: labelRows.map(({ file, symbol, reason, reported, reportedConfidence }) => ({
      file,
      symbol,
      reason,
      reported,
      reportedConfidence,
    })),
  };
}

const round = (x) => Math.round(x * 10000) / 10000;

// ---------------------------------------------------------------- affected-tests (typer / coverage)

function scoreTyperAffected(entry, outDir) {
  const status = readJson(path.join(outDir, 'status.json'), { metrics: {} });
  const st = (status.metrics || {})['affected-tests'];
  if (!st || st.status !== 'ok') {
    return { status: 'pending', reason: (st && st.reason) || 'coverage truth not generated; run `node eval/run.js typer`' };
  }
  const gtFile = path.join(outDir, 'gt.json');
  const gt = readJson(gtFile, null);
  if (!gt || !gt.map) return { status: 'pending', reason: 'gt.json missing; run `node eval/run.js typer`' };
  const repoDir = path.join(REPOS_DIR, entry.name);
  const preds = loadPredictions(repoDir);
  if (!preds) {
    return { status: 'pending', reason: 'precomputed_impact unavailable (cache.db missing — run `node eval/run.js typer`) or node:sqlite unsupported' };
  }

  // same is_test rule as test/eval_affected_tests.py: tests/ + test_*.py
  const isTest = (p) => p.startsWith('tests/') && p.split('/').pop().startsWith('test_');
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let files = 0;
  for (const [src, realList] of Object.entries(gt.map)) {
    const real = new Set(realList);
    const guess = new Set([...(preds.get(src) || [])].filter(isTest));
    const hit = [...guess].filter((t) => real.has(t)).length;
    tp += hit;
    fp += guess.size - hit;
    fn += real.size - hit;
    files++;
  }
  return {
    status: 'ok',
    precision: round(tp / Math.max(tp + fp, 1)),
    recall: round(tp / Math.max(tp + fn, 1)),
    n: tp + fp + fn,
    filesScored: files,
    tp,
    fp,
    fn,
  };
}

// --------------------------- -------------------------------- affected-tests (fault injection)

const TEST_PATH_RULES = {
  'spring-petclinic': (f) => f.includes('/src/test/') && f.endsWith('.java'),
  vitesse: (f) => f.startsWith('test/') && /\.(test|spec)\.[cm]?[jt]sx?$/.test(f),
};

function normalizeRel(repoDir, p) {
  let f = String(p || '').replace(/\\/g, '/');
  if (path.isAbsolute(f)) f = path.relative(repoDir, f).replace(/\\/g, '/');
  return f.replace(/^\.\//, '');
}

function cliAffectedTests(repoDir, file) {
  const abs = path.isAbsolute(file) ? file : path.join(repoDir, file);
  const r = sh(process.execPath, [CLI, 'affected-tests', '--cwd', repoDir, '--file', abs, '--json', '--quiet'], {
    maxBuffer: 256 * 1024 * 1024,
    timeout: 5 * 60 * 1000,
  });
  if (r.status !== 0) return null;
  try {
    return JSON.parse(r.stdout);
  } catch {
    return null;
  }
}

function scoreFaultAffected(entry, outDir) {
  const truthFile = path.join(outDir, 'affected-tests-truth.json');
  const status = readJson(path.join(outDir, 'status.json'), { metrics: {} });
  if (!fs.existsSync(truthFile)) {
    const st = (status.metrics || {})['affected-tests'];
    return {
      status: 'pending',
      reason: (st && st.reason) || `fault-injection truth missing; run \`node eval/inject-fault.js ${entry.name}\``,
    };
  }
  const truth = readJson(truthFile, null);
  if (!truth || !Array.isArray(truth.files)) return { status: 'pending', reason: 'affected-tests-truth.json unreadable' };

  const repoDir = path.join(REPOS_DIR, entry.name);
  const isTest = TEST_PATH_RULES[entry.name] || (() => true);
  let tp = 0;
  let fp = 0;
  let fn = 0;
  const perFile = [];
  for (const rec of truth.files) {
    if (rec.error) {
      perFile.push({ file: rec.file, error: rec.error });
      continue;
    }
    const res = cliAffectedTests(repoDir, rec.file);
    if (!res || res.ok === false) {
      perFile.push({ file: rec.file, error: 'affected-tests CLI failed' });
      continue;
    }
    const pred = new Set(
      (res.affectedTests || [])
        .map((t) => normalizeRel(repoDir, typeof t === 'string' ? t : t.file))
        .filter((f) => f && isTest(f))
    );
    const real = new Set((rec.failingTestFiles || []).map((f) => normalizeRel(repoDir, f)));
    const h = [...pred].filter((f) => real.has(f)).length;
    tp += h;
    fp += pred.size - h;
    fn += real.size - h;
    perFile.push({ file: rec.file, real: real.size, pred: pred.size, hit: h });
  }
  if (tp + fp + fn === 0) return { status: 'pending', reason: 'fault truth produced no scorable entries (all runs errored?)' };
  return {
    status: 'ok',
    precision: round(tp / Math.max(tp + fp, 1)),
    recall: round(tp / Math.max(tp + fn, 1)),
    n: tp + fp + fn,
    tp,
    fp,
    fn,
    perFile,
  };
}

// ---------------------------------------------------------------- baseline comparison

const COMPARE_KEYS = ['precision', 'recall', 'precisionHigh', 'precisionLow'];

function compareBaseline(scoreboard) {
  const baseline = readJson(path.join(EVAL_DIR, 'baseline.json'), null);
  if (!baseline) {
    log('no eval/baseline.json yet — skipping comparison (populate it from this scoreboard)');
    return [];
  }
  const verdicts = [];
  for (const [repoName, metrics] of Object.entries(scoreboard.repos || {})) {
    const baseRepo = (baseline.repos || {})[repoName] || {};
    for (const metric of ['affected-tests', 'dead-code']) {
      const cur = metrics[metric];
      const base = baseRepo[metric];
      if (!cur || !base) continue;
      for (const key of COMPARE_KEYS) {
        if (typeof cur[key] !== 'number' || typeof base[key] !== 'number') continue;
        const delta = round(cur[key] - base[key]);
        const result = delta < -0.05 ? 'FAIL' : 'PASS';
        verdicts.push({ repo: repoName, metric: `${metric}.${key}`, baseline: base[key], current: cur[key], delta, result });
      }
    }
  }
  return verdicts;
}

// ---------------------------------------------------------------- main

function main() {
  const scoreboard = {
    generatedAt: new Date().toISOString(),
    wbVersion: pkg.version,
    repos: {},
  };

  for (const entry of corpus.repos) {
    const outDir = path.join(OUT_DIR, entry.name);
    const repoScores = { heldOut: entry.heldOut };

    if (entry.metrics.includes('dead-code')) repoScores['dead-code'] = scoreDeadCode(entry, outDir);

    if (entry.metrics.includes('affected-tests')) {
      if (entry.name === 'typer') repoScores['affected-tests'] = scoreTyperAffected(entry, outDir);
      else repoScores['affected-tests'] = scoreFaultAffected(entry, outDir);
    }

    scoreboard.repos[entry.name] = repoScores;
  }

  scoreboard.verdicts = compareBaseline(scoreboard);
  scoreboard.summary = {
    fail: scoreboard.verdicts.filter((v) => v.result === 'FAIL').length,
    pass: scoreboard.verdicts.filter((v) => v.result === 'PASS').length,
  };

  writeJson(path.join(EVAL_DIR, 'scoreboard.json'), scoreboard);

  // human summary
  for (const [name, m] of Object.entries(scoreboard.repos)) {
    const at = m['affected-tests'];
    const dc = m['dead-code'];
    const atStr =
      at.status === 'ok'
        ? `precision=${at.precision} recall=${at.recall} n=${at.n}`
        : `pending (${at.reason})`;
    const dcStr =
      dc.status === 'ok'
        ? `precision=${dc.precision} high=${dc.precisionHigh} low=${dc.precisionLow} n=${dc.n} [labeledReported=${dc.counts.labeledReported}/${dc.counts.labeledRows}]`
        : `pending (${dc.reason})`;
    log(`${name}: affected-tests: ${atStr}`);
    log(`${name}: dead-code:      ${dcStr}`);
  }
  for (const v of scoreboard.verdicts) {
    log(`${v.result}: ${v.repo} ${v.metric} baseline=${v.baseline} current=${v.current} delta=${v.delta}`);
  }
  log(`scoreboard written to eval/scoreboard.json (exit 0 — scoring, not gating)`);
  process.exit(0);
}

main();
