// @semantic — Full cold CLI experiment; workers only parse, SQLite stays on main thread.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-full-workers-'));
const repos = ['python/typer', 'go/cobra', 'java/spring-petclinic'];
const report = { scope: 'Full cold audit-overview, 2 parse workers; index, resolve, graph, analysis and SQLite remain on main thread; 3 trials, existing fixed corpora', cases: [] };
function run(repo, mode, trial) {
  const cache = path.join(scratch, `${repo.replaceAll('/', '-')}-${mode}-${trial}`);
  const resourceFile = path.join(scratch, `${repo.replaceAll('/', '-')}-${mode}-${trial}-resources.json`);
  const args = ['--require', path.join(__dirname, 'resource-probe-preload.js')];
  if (mode === 'worker') args.push('--require', path.join(__dirname, 'parser-worker-preload.js'));
  args.push(path.join(root, 'cli.js'), 'audit-overview', '--cwd', path.join(__dirname, 'truth/repos', repo), '--json', '--quiet');
  const start = performance.now();
  const result = spawnSync(process.execPath, args, { env: { ...process.env, WB_CACHE_DIR: cache, WB_SPIKE_RESOURCE_FILE: resourceFile }, encoding: 'utf8', timeout: 180000, maxBuffer: 32 * 1024 * 1024 });
  if (result.error || result.status !== 0) return { mode, trial, elapsedMs: Math.round(performance.now() - start), exitCode: result.status, error: result.error?.message || result.stderr };
  const data = JSON.parse(result.stdout.replace(/^\uFEFF/, ''));
  return { mode, trial, elapsedMs: Math.round(performance.now() - start), exitCode: result.status, resources: JSON.parse(fs.readFileSync(resourceFile, 'utf8')), counts: data.summary?.counts, coverage: data.analysisCoverage, hotspots: data.hotspots?.map((item) => ({ file: item.file, score: item.score })).sort((a, b) => a.file.localeCompare(b.file)), cacheBytes: fs.statSync(path.join(cache, 'cache.db')).size };
}
for (const repo of repos) {
  if (!fs.existsSync(path.join(__dirname, 'truth/repos', repo))) { report.cases.push({ repo, missing: true }); continue; }
  const samples = [];
  for (let trial = 0; trial < 3; trial++) for (const mode of ['serial', 'worker']) {
    const sample = run(repo, mode, trial);
    samples.push(sample);
    console.log(JSON.stringify({ repo, ...sample }));
  }
  const canonical = (sample) => JSON.stringify({ counts: sample.counts, coverage: sample.coverage, hotspots: sample.hotspots });
  report.cases.push({ repo, samples, sampledOutputEqual: samples.every((sample) => !sample.error && canonical(sample) === canonical(samples[0])) });
}
fs.writeFileSync(path.join(__dirname, 'truth/full-parser-workers.json'), JSON.stringify(report, null, 2) + '\n');
