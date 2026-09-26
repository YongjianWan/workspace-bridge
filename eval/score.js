#!/usr/bin/env node
/**
 * workspace-bridge evaluation scorer.
 *
 * Usage:
 *   node eval/score.js
 *
 * Reads eval/truth/out/<lang>/<name>/* (run outputs + generated truth) and
 * eval/labels/*.jsonl, writes eval/scoreboard.json. Compares against
 * eval/baseline.json when present: a ratio metric worse than baseline by
 * > 0.05 prints FAIL, else PASS. Always exits 0 — this scores, it does not gate.
 *
 * Metrics
 *   health: copied from health.json (no truth — coverage, fallback,
 *     unresolved/dropped, warnings, cold/warm ms, cache bytes, dead-export
 *     counts). Only coverageRatio is compared against baseline; the rest is
 *     reported for trend reading (timings swing with machine throttling).
 *   affected-tests, coverage-pytest: micro precision/recall ported from
 *     test/eval_affected_tests.py (truth = gt.json, predictions =
 *     precomputed_impact in the eval-pinned cache.db). The python file stays
 *     authoritative for methodology but is not shelled out: on Windows its
 *     os.path.relpath yields backslashes while its is_test filter checks
 *     `tests/` (see eval/findings.md). The port normalizes separators and
 *     otherwise reproduces its loop exactly.
 *   affected-tests, fault-injection: truth = affected-tests-truth.json from
 *     eval/inject-fault.js; predictions = CLI `affected-tests --file` per
 *     injected file, both sides filtered by lib.TEST_FILE_RULES[runner].
 *   dead-code: precision = unlabeled findings / (unlabeled + labeled-FP still
 *     reported), split by tool-reported confidence. Labels only mark known
 *     false positives, unlabeled findings are presumed true — a relative metric.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const lib = require('./lib');

const { CLI, EVAL_DIR, ROOT, sh, readJson, writeJson, toPosix, toRepoRel } = lib;

const REGRESSION_TOLERANCE = 0.05;
const CLI_TIMEOUT_MS = 5 * 60 * 1000;
const COMPARE_KEYS = ['precision', 'recall', 'precisionHigh', 'precisionLow', 'coverageRatio'];

const log = (msg) => console.log(`[eval] ${msg}`);
const round = (x) => Math.round(x * 10000) / 10000;
const ratio = (num, den) => round(num / Math.max(den, 1));
const pending = (reason) => ({ status: 'pending', reason });

function statusOf(entry, metric) {
  return (readJson(path.join(lib.outDir(entry), 'status.json'), {}).metrics || {})[metric] || null;
}

function microPR(pairs) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const { pred, real } of pairs) {
    const hit = [...pred].filter((t) => real.has(t)).length;
    tp += hit;
    fp += pred.size - hit;
    fn += real.size - hit;
  }
  return { precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn), n: tp + fp + fn, tp, fp, fn };
}

// ---------------------------------------------------------------- health

function scoreHealth(entry) {
  const health = readJson(path.join(lib.outDir(entry), 'health.json'), null);
  if (!health) return pending(`health.json missing; run \`node eval/run.js ${entry.name}\``);
  return { status: 'ok', ...health };
}

// ---------------------------------------------------------------- dead-code

function loadLabels(repoName) {
  const file = path.join(EVAL_DIR, 'labels', `${repoName}.jsonl`);
  if (!fs.existsSync(file)) return null;
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
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
  const l = toPosix(labelFile);
  const f = toPosix(findingFile);
  if (!l.includes('/')) return f.split('/').pop() === l; // bare filename label matches by basename
  return /[*?]/.test(l) ? globToRegex(l).test(f) : l === f;
}

const labelMatches = (label, finding) =>
  labelFileMatches(label.file, finding.file) && (label.symbol === '*' || label.symbol === finding.symbol);

function scoreDeadCode(entry) {
  const findingsFile = path.join(lib.outDir(entry), 'dead-exports.json');
  if (!fs.existsSync(findingsFile)) return pending(`dead-exports.json missing; run \`node eval/run.js ${entry.name}\``);
  const labels = loadLabels(entry.name);
  if (!labels) return pending(`no labels file eval/labels/${entry.name}.jsonl`);

  const repoDir = lib.repoDir(entry);
  const findings = [];
  for (const item of readJson(findingsFile, {}).deadExports || []) {
    const file = toRepoRel(repoDir, item.file);
    for (const symbol of item.exports || []) findings.push({ file, symbol, confidence: item.confidence || 'unknown' });
  }

  const labelRows = labels.map((l) => ({ ...l, reported: false, reportedConfidence: null }));
  const byConf = {};
  const total = { tp: 0, fp: 0 };
  for (const f of findings) {
    const hit = labelRows.find((l) => labelMatches(l, f));
    if (hit) {
      hit.reported = true;
      hit.reportedConfidence = f.confidence;
    }
    const bucket = (byConf[f.confidence] = byConf[f.confidence] || { tp: 0, fp: 0 });
    bucket[hit ? 'fp' : 'tp']++;
    total[hit ? 'fp' : 'tp']++;
  }

  const prec = (x) => (x.tp + x.fp > 0 ? round(x.tp / (x.tp + x.fp)) : null);
  const byConfidence = {};
  for (const [k, v] of Object.entries(byConf)) byConfidence[k] = { precision: prec(v), n: v.tp + v.fp, ...v };
  const labeledReported = labelRows.filter((l) => l.reported).length;
  return {
    status: 'ok',
    precision: prec(total),
    precisionHigh: byConfidence.high ? byConfidence.high.precision : null,
    precisionLow: byConfidence.low ? byConfidence.low.precision : null,
    byConfidence,
    n: findings.length,
    counts: {
      labeledRows: labelRows.length,
      labeledReported,
      labeledNotReported: labelRows.length - labeledReported,
      unlabeledFindings: total.tp,
      labeledFindings: total.fp,
    },
    labeledRows: labelRows.map(({ file, symbol, reason, reported, reportedConfidence }) => ({ file, symbol, reason, reported, reportedConfidence })),
  };
}

// ---------------------------------------------------------------- affected-tests

// precomputed_impact: file -> affected tests, from the cache run.js pinned via WB_CACHE_DIR
function loadPredictions(entry) {
  const dbPath = path.join(lib.outDir(entry), 'cache', 'cache.db');
  if (!fs.existsSync(dbPath)) return null;
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const rows = db.prepare('SELECT file, affected_tests FROM precomputed_impact').all();
  db.close();
  const repoDir = lib.repoDir(entry);
  const preds = new Map();
  for (const r of rows) {
    const set = preds.get(toRepoRel(repoDir, r.file)) || new Set();
    for (const t of JSON.parse(r.affected_tests || '[]')) set.add(toRepoRel(repoDir, typeof t === 'string' ? t : t.file));
    preds.set(toRepoRel(repoDir, r.file), set);
  }
  return preds;
}

function scoreCoverageAffected(entry) {
  const st = statusOf(entry, 'affected-tests');
  if (!st || st.status !== 'ok') return pending((st && st.reason) || `coverage truth not generated; run \`node eval/run.js ${entry.name}\``);
  const gt = readJson(path.join(lib.outDir(entry), 'gt.json'), null);
  if (!gt || !gt.map) return pending(`gt.json missing; run \`node eval/run.js ${entry.name}\``);
  const preds = loadPredictions(entry);
  if (!preds) return pending(`cache.db missing; run \`node eval/run.js ${entry.name}\``);

  // same is_test rule as test/eval_affected_tests.py: <tests>/ + test_*.py
  const testsDir = `${entry.affectedTests.tests}/`;
  const isTest = (p) => p.startsWith(testsDir) && p.split('/').pop().startsWith('test_');
  const pairs = Object.entries(gt.map).map(([src, real]) => ({
    real: new Set(real),
    pred: new Set([...(preds.get(src) || [])].filter(isTest)),
  }));
  return { status: 'ok', ...microPR(pairs), filesScored: pairs.length };
}

function cliAffectedTests(entry, file) {
  const repoDir = lib.repoDir(entry);
  const r = sh(process.execPath, [CLI, 'affected-tests', '--cwd', repoDir, '--file', path.join(repoDir, file), '--json', '--quiet'], {
    env: { ...process.env, WB_CACHE_DIR: path.join(lib.outDir(entry), 'cache') },
    timeout: CLI_TIMEOUT_MS,
  });
  if (r.status !== 0) return null;
  try {
    return JSON.parse(r.stdout);
  } catch {
    return null;
  }
}

function scoreFaultAffected(entry) {
  const truth = readJson(path.join(lib.outDir(entry), 'affected-tests-truth.json'), null);
  if (!truth || !Array.isArray(truth.files)) {
    const st = statusOf(entry, 'affected-tests');
    return pending((st && st.reason) || `fault-injection truth missing; run \`node eval/inject-fault.js ${entry.name}\``);
  }
  const repoDir = lib.repoDir(entry);
  const isTest = lib.TEST_FILE_RULES[entry.affectedTests.runner];
  const pairs = [];
  const perFile = [];
  for (const rec of truth.files) {
    if (rec.error) {
      perFile.push({ file: rec.file, error: rec.error.slice(0, 200) });
      continue;
    }
    const res = cliAffectedTests(entry, rec.file);
    if (!res || res.ok === false) {
      perFile.push({ file: rec.file, error: 'affected-tests CLI failed' });
      continue;
    }
    const pred = new Set(
      (res.affectedTests || []).map((t) => toRepoRel(repoDir, typeof t === 'string' ? t : t.file)).filter((f) => f && isTest(f))
    );
    const real = new Set(rec.failingTestFiles || []);
    pairs.push({ pred, real });
    perFile.push({ file: rec.file, real: real.size, pred: pred.size, hit: [...pred].filter((f) => real.has(f)).length });
  }
  const pr = microPR(pairs);
  if (pr.n === 0) return pending('fault truth produced no scorable entries (all runs errored, or no test failed)');
  return { status: 'ok', ...pr, perFile };
}

function scoreAffected(entry) {
  return entry.affectedTests.method === 'coverage-pytest' ? scoreCoverageAffected(entry) : scoreFaultAffected(entry);
}

// ---------------------------------------------------------------- baseline comparison

function compareBaseline(scoreboard) {
  const baseline = readJson(path.join(EVAL_DIR, 'baseline.json'), null);
  if (!baseline) {
    log('no eval/baseline.json yet — skipping comparison (populate it from this scoreboard)');
    return [];
  }
  const verdicts = [];
  for (const [repoName, metrics] of Object.entries(scoreboard.repos)) {
    const baseRepo = (baseline.repos || {})[repoName] || {};
    for (const [metric, cur] of Object.entries(metrics)) {
      const base = baseRepo[metric];
      if (!cur || !base || typeof cur !== 'object') continue;
      for (const key of COMPARE_KEYS) {
        if (typeof cur[key] !== 'number' || typeof base[key] !== 'number') continue;
        const delta = round(cur[key] - base[key]);
        verdicts.push({
          repo: repoName,
          metric: `${metric}.${key}`,
          baseline: base[key],
          current: cur[key],
          delta,
          result: delta < -REGRESSION_TOLERANCE ? 'FAIL' : 'PASS',
        });
      }
    }
  }
  return verdicts;
}

// ---------------------------------------------------------------- summary

const SCORERS = { health: scoreHealth, 'dead-code': scoreDeadCode, 'affected-tests': scoreAffected };

const mismatchNote = (diff) => (diff && Object.keys(diff).length ? ` COLD/WARM MISMATCH ${JSON.stringify(diff)}` : '');

function describe(metric, m) {
  if (m.status !== 'ok') return `pending (${m.reason})`;
  if (metric === 'health') {
    return `files=${m.totalFiles} coverage=${m.coverageRatio} fallback=${m.fallbackFiles} unresolved=${m.unresolvedCount} dropped=${m.droppedCount} warnings=${m.warnings} cold=${m.coldMs}ms warm=${m.warmMs}ms cache=${Math.round(m.cacheBytes / 1024)}KB${mismatchNote(m.coldWarmDiff)}`;
  }
  if (metric === 'dead-code') {
    return `precision=${m.precision} high=${m.precisionHigh} low=${m.precisionLow} n=${m.n} [labeledReported=${m.counts.labeledReported}/${m.counts.labeledRows}]`;
  }
  return `precision=${m.precision} recall=${m.recall} n=${m.n}`;
}

function main() {
  const corpus = lib.loadCorpus();
  const pkg = readJson(path.join(ROOT, 'package.json'), {});
  const scoreboard = { generatedAt: new Date().toISOString(), wbVersion: pkg.version, repos: {} };

  for (const entry of corpus.repos) {
    const scores = { lang: entry.lang, heldOut: entry.heldOut };
    for (const metric of entry.metrics) scores[metric] = SCORERS[metric](entry);
    scoreboard.repos[entry.name] = scores;
  }
  scoreboard.verdicts = compareBaseline(scoreboard);
  scoreboard.summary = {
    fail: scoreboard.verdicts.filter((v) => v.result === 'FAIL').length,
    pass: scoreboard.verdicts.filter((v) => v.result === 'PASS').length,
  };
  writeJson(path.join(EVAL_DIR, 'scoreboard.json'), scoreboard);

  for (const lang of lib.LANG_DIRS) {
    const repos = Object.entries(scoreboard.repos).filter(([, s]) => s.lang === lang);
    if (!repos.length) continue;
    log(`--- ${lang} ---`);
    for (const [name, s] of repos) {
      for (const metric of Object.keys(SCORERS)) if (s[metric]) log(`${name} ${metric}: ${describe(metric, s[metric])}`);
    }
  }
  for (const v of scoreboard.verdicts) log(`${v.result}: ${v.repo} ${v.metric} baseline=${v.baseline} current=${v.current} delta=${v.delta}`);
  log('scoreboard written to eval/scoreboard.json (exit 0 — scoring, not gating)');
}

main();
