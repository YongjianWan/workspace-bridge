#!/usr/bin/env node
/**
 * Resolver precision benchmark — symbol-table strategy.
 *
 * Usage:
 *   node scripts/resolver-precision.js <repo> [<repo> ...]
 *   node scripts/resolver-precision.js reference/zod reference/execa   # 逐仓点名
 *   node scripts/resolver-precision.js --json reference/GitNexus
 *
 * 勿用 reference/* 通配：该目录混有非仓文件；编制与各仓闸状态见
 * reference/README.md（无闸仓的精度数据不可信，先补闸再测）。
 *
 * Why this exists (TECH_DEBT L2-10): `trySymbolTable` is the last strategy in
 * every resolver chain, so it fires on every import no other strategy could
 * resolve, and each hit becomes an edge carrying confidence 0.8. Its four
 * disambiguation constants (SYMBOL_DISAMBIGUATION in src/config/scoring.js)
 * have no measured basis, and unit tests can only lock invariants — they
 * cannot tell you whether the strategy earns its keep. This script produces
 * the number: how many edges it contributes per repo, and the exact
 * (importer, specifier, target) triples so a human can confirm or reject them.
 *
 * Measured on 2026-07-28 (this repo, before the external-dependency gate):
 * 212 of 1230 edges came from symbol-table, all 212 wrong and all identical in
 * shape — every `require('path')` resolved to `parsers/js/shared.js`, which
 * re-exported its own `require('path')`. Both the gate and the deletion of that
 * re-export now suppress it independently, so re-running this on a clean tree
 * reports 0; disable the gate to see the mechanism. That is the failure mode
 * this benchmark is meant to catch early.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const REPO_ROOT = path.resolve(__dirname, '..');
const CLI_PATH = path.join(REPO_ROOT, 'cli.js');

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const targets = args.filter((a) => !a.startsWith('--'));

if (targets.length === 0) {
  console.error('usage: node scripts/resolver-precision.js [--json] <repo> [<repo> ...]');
  process.exit(2);
}

/** Build a fresh graph for `repo` in a throwaway cache dir and return its path. */
function buildGraph(repo) {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-precision-'));
  const res = spawnSync(
    process.execPath,
    [CLI_PATH, 'audit-summary', '--cwd', repo, '--cache-dir', cacheDir, '--quiet', '--json'],
    { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 }
  );
  if (res.status !== 0) {
    return { cacheDir, error: `audit-summary exited ${res.status}: ${(res.stderr || '').slice(0, 300)}` };
  }
  return { cacheDir, error: null };
}

/**
 * Join edges to the import specifier that produced them.
 *
 * The edges table records how an edge was resolved but not what was written in
 * the source; parse_results carries importRecords with the original specifier.
 * Without that join a reviewer cannot judge a hit, only count it.
 */
function collect(cacheDir) {
  const db = new DatabaseSync(path.join(cacheDir, 'cache.db'), { readOnly: true });

  const totalEdges = db.prepare('SELECT COUNT(*) c FROM edges').get().c;
  const byMethod = db.prepare(
    'SELECT resolution_method m, COUNT(*) c FROM edges GROUP BY resolution_method ORDER BY c DESC'
  ).all();
  const symbolEdges = db.prepare(
    "SELECT source, target FROM edges WHERE resolution_method = 'symbol-table'"
  ).all();

  const specifierByPair = new Map();
  const parseRows = db.prepare('SELECT path, import_records FROM parse_results').all();
  for (const row of parseRows) {
    let records;
    try {
      records = JSON.parse(row.import_records || '[]');
    } catch {
      continue;
    }
    for (const rec of records) {
      if (!rec || !rec.resolved) continue;
      specifierByPair.set(`${row.path}\u0000${rec.resolved}`, rec.source ?? rec.raw ?? rec.specifier ?? '?');
    }
  }
  db.close();

  const hits = symbolEdges.map((e) => ({
    importer: e.source,
    specifier: specifierByPair.get(`${e.source}\u0000${e.target}`) ?? '(specifier not recorded)',
    target: e.target,
  }));

  return { totalEdges, byMethod, hits };
}

function relative(repo, file) {
  const rel = path.relative(repo, file);
  return rel.startsWith('..') ? file : rel;
}

const report = [];

for (const target of targets) {
  const repo = path.resolve(target);
  if (!fs.existsSync(repo)) {
    console.error(`skip ${target}: not found`);
    continue;
  }

  const { cacheDir, error } = buildGraph(repo);
  if (error) {
    console.error(`skip ${target}: ${error}`);
    fs.rmSync(cacheDir, { recursive: true, force: true });
    continue;
  }

  const { totalEdges, byMethod, hits } = collect(cacheDir);
  fs.rmSync(cacheDir, { recursive: true, force: true });

  report.push({
    repo: path.basename(repo),
    totalEdges,
    symbolTableEdges: hits.length,
    share: totalEdges > 0 ? Number(((hits.length / totalEdges) * 100).toFixed(2)) : 0,
    byMethod: Object.fromEntries(byMethod.map((r) => [r.m || 'unknown', r.c])),
    hits: hits.map((h) => ({
      importer: relative(repo, h.importer),
      specifier: h.specifier,
      target: relative(repo, h.target),
    })),
  });
}

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log('| repo | edges | symbol-table | share |');
  console.log('| --- | ---: | ---: | ---: |');
  for (const r of report) {
    console.log(`| ${r.repo} | ${r.totalEdges} | ${r.symbolTableEdges} | ${r.share}% |`);
  }
  for (const r of report) {
    if (r.hits.length === 0) continue;
    console.log(`\n### ${r.repo} — ${r.hits.length} symbol-table 边（需人工确认）\n`);
    for (const h of r.hits.slice(0, 40)) {
      console.log(`- ${h.importer}  —[${h.specifier}]→  ${h.target}`);
    }
    if (r.hits.length > 40) console.log(`- … 另有 ${r.hits.length - 40} 条`);
  }
}
