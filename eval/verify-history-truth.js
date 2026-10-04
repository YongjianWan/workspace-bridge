// @semantic — Independently controlled churn, blame shares and structural scores.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { getFileKnowledgeRisk } = require('../src/tools/git-tools');
const root = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-history-truth-'));
function git(args, date = '2026-10-03T08:00:00Z', author = 'Alpha <alpha@example.invalid>') {
  const run = spawnSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date, GIT_AUTHOR_NAME: author.split(' <')[0], GIT_AUTHOR_EMAIL: author.split('<')[1].slice(0, -1), GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' } });
  if (run.status !== 0) throw new Error(run.stderr);
  return run.stdout.trim();
}
function content(name) { return Array.from({ length: 40 }, (_, i) => `export const ${name}_${i} = ${i};`).join('\n') + '\n'; }
git(['init', '-b', 'main']);
for (const file of ['hot', 'cold', 'solo', 'shared']) fs.writeFileSync(path.join(dir, `${file}.js`), content(file));
git(['add', '.']); git(['commit', '-qm', 'initial'], '2020-01-01T00:00:00Z');
for (let i = 0; i < 20; i++) {
  fs.writeFileSync(path.join(dir, 'hot.js'), content('hot') + `export const edit = ${i};\n`);
  git(['add', 'hot.js']); git(['commit', '-qm', `hot-${i}`]);
}
for (const [index, author] of ['Beta <beta@example.invalid>', 'Gamma <gamma@example.invalid>', 'Delta <delta@example.invalid>'].entries()) {
  const lines = fs.readFileSync(path.join(dir, 'shared.js'), 'utf8').trimEnd().split('\n');
  for (let i = (index + 1) * 10; i < (index + 2) * 10; i++) lines[i] = `export const shared_${i} = ${100 + i};`;
  fs.writeFileSync(path.join(dir, 'shared.js'), lines.join('\n') + '\n');
  git(['add', 'shared.js']); git(['commit', '-qm', `share-${index}`], '2026-10-03T08:00:00Z', author);
}
(async () => {
  const cli = spawnSync(process.execPath, [path.join(root, 'cli.js'), 'audit-overview', '--cwd', dir, '--with-history', '--json', '--quiet'], { env: { ...process.env, WB_CACHE_DIR: path.join(dir, '.cache') }, encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
  if (cli.status !== 0) throw new Error(cli.stderr);
  const overview = JSON.parse(cli.stdout.replace(/^\uFEFF/, ''));
  const solo = await getFileKnowledgeRisk(dir, 'solo.js');
  const shared = await getFileKnowledgeRisk(dir, 'shared.js');
  const report = { dir, truth: { hotCommits: 21, coldCommits: 1, soloAuthors: 1, soloPrimaryFraction: 1, sharedAuthors: 4, sharedPrimaryFraction: 0.25 }, hotCommits: Number(git(['rev-list', '--count', 'HEAD', '--', 'hot.js'])), coldCommits: Number(git(['rev-list', '--count', 'HEAD', '--', 'cold.js'])), solo, shared, overview, scope: 'Controlled churn and ownership proxy validity only; cannot prove prediction of bugs, outages or human knowledge retention' };
  fs.writeFileSync(path.join(__dirname, 'truth/history-truth.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ truth: report.truth, solo: { authors: solo.authorCount, fraction: solo.primaryAuthorPct, risk: solo.riskLevel }, shared: { authors: shared.authorCount, fraction: shared.primaryAuthorPct, risk: shared.riskLevel }, hotspots: overview.hotspots, stability: overview.stability }));
})().catch((error) => { console.error(error); process.exitCode = 1; });
