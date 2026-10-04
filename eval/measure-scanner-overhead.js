// @semantic — Paired cold project-cache observations; no system protection changes.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const root = path.resolve(__dirname, '..');
const label = process.argv[2];
if (!['tencent-paused', 'tencent-running'].includes(label)) throw new Error('Specify scanner condition');
const repo = path.join(__dirname, 'truth/repos/python/typer');
const out = path.join(__dirname, 'truth/scanner-overhead');
fs.mkdirSync(out, { recursive: true });
const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' });
if (git.status !== 0 || !git.stdout.startsWith('a80f6e5ecd')) throw new Error('Wrong fixed corpus');
const samples = [];
for (let i = 0; i < 3; i++) {
  const cache = fs.mkdtempSync(path.join(out, `${label}-cache-`));
  const start = performance.now();
  const run = spawnSync(process.execPath, [path.join(root, 'cli.js'), 'audit-overview',
    '--cwd', repo, '--json', '--quiet'], { encoding: 'utf8', timeout: 180000,
    maxBuffer: 32 * 1024 * 1024, env: { ...process.env, WB_CACHE_DIR: cache } });
  const elapsedMs = performance.now() - start;
  if (run.error || run.status !== 0) throw new Error(run.error || run.stderr);
  const data = JSON.parse(run.stdout.replace(/^\uFEFF/, ''));
  samples.push({ run: i + 1, elapsedMs: Math.round(elapsedMs), exitCode: run.status,
    coverage: data.analysisCoverage, counts: data.summary?.counts,
    cacheBytes: fs.existsSync(path.join(cache, 'cache.db')) ? fs.statSync(path.join(cache, 'cache.db')).size : null });
  console.log(JSON.stringify({ label, ...samples.at(-1) }));
}
const report = { label, commit: git.stdout.trim(), node: process.version, platform: process.platform,
  protection: 'Tencent condition supplied by owner; Sangfor remains active; Defender previously reported off',
  cacheCondition: 'Fresh project cache each run; OS filesystem cache is not flushed', samples,
  medianMs: samples.map(sample => sample.elapsedMs).sort((a, b) => a - b)[1] };
fs.writeFileSync(path.join(out, `${label}.json`), JSON.stringify(report, null, 2) + '\n');
