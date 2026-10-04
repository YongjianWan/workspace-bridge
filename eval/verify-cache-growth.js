// @semantic — Cache growth under bounded workspace churn; not a months-long soak.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-cache-growth-'));
const cacheRoot = path.join(scratch, 'cache');
const env = { ...process.env, LOCALAPPDATA: cacheRoot, XDG_CACHE_HOME: cacheRoot };
delete env.WB_CACHE_DIR;
const report = { scope: { projects: 8, filesPerProject: 400, rounds: 4, contentChurnRounds: 2 }, checkpoints: [] };
function inventory(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? inventory(file) : [{ file: path.relative(cacheRoot, file), bytes: fs.statSync(file).size }];
  });
}
function measure(label) {
  const files = inventory(cacheRoot);
  const point = { label, files: files.length, databases: files.filter((file) => file.file.endsWith('cache.db')).length, bytes: files.reduce((sum, file) => sum + file.bytes, 0) };
  report.checkpoints.push(point);
  console.log(JSON.stringify(point));
}
function source(index, round) {
  return `${index ? `const previous = require('./file-${index - 1}');\n` : ''}module.exports = ${index ? 'previous + ' : ''}${round + 1};\n`;
}
function run(dir) {
  const result = spawnSync(process.execPath, [path.join(root, 'cli.js'), 'audit-overview', '--cwd', dir, '--json', '--quiet'], { env, encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw result.error || new Error(result.stderr);
  const data = JSON.parse(result.stdout.replace(/^\uFEFF/, ''));
  return { files: data.summary?.fileCount ?? data.summary?.totalFiles, coverage: data.summary?.analysisCoverage ?? data.analysisCoverage, warnings: data.warnings };
}
const projects = [];
for (let project = 0; project < report.scope.projects; project++) {
  const dir = path.join(scratch, `project-${project}`);
  fs.mkdirSync(dir);
  projects.push(dir);
  for (let file = 0; file < report.scope.filesPerProject; file++) fs.writeFileSync(path.join(dir, `file-${file}.js`), source(file, 0));
  run(dir);
  measure(`created-${project + 1}`);
}
for (let round = 0; round < report.scope.rounds; round++) {
  for (const dir of projects) run(dir);
  measure(`unchanged-${round + 1}`);
}
for (let round = 0; round < report.scope.contentChurnRounds; round++) {
  for (const dir of projects) {
    for (let file = 0; file < report.scope.filesPerProject; file++) fs.writeFileSync(path.join(dir, `file-${file}.js`), source(file, round + 1));
    run(dir);
  }
  measure(`rewritten-${round + 1}`);
}
report.finalAnalyses = projects.map(run);
measure('final-repeat');
for (const dir of projects) {
  if (path.dirname(path.resolve(dir)) !== path.resolve(scratch)) throw new Error('cleanup escaped fixture');
  fs.rmSync(dir, { recursive: true, force: true });
}
measure('workspaces-deleted');
const unchanged = report.checkpoints.filter((point) => point.label.startsWith('unchanged-'));
report.unchangedBytesStable = unchanged.every((point) => point.bytes === unchanged[0].bytes);
report.scratch = scratch;
fs.mkdirSync(path.join(__dirname, 'truth'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'truth/cache-growth.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ unchangedBytesStable: report.unchangedBytesStable, final: report.checkpoints.at(-1) }));
