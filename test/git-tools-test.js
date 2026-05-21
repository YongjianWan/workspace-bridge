const assert = require('assert');
const path = require('path');
const { getChangedFiles, getChangedLineRanges, getFileHistoryRisk, getDiffNumstat, parsePorcelainV1Line } = require('../src/tools/git-tools');

const REPO_ROOT = path.resolve(__dirname, '..');

async function testGetChangedFilesStaged() {
  const result = await getChangedFiles(REPO_ROOT, { staged: true });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.workspaceRoot, REPO_ROOT);
  assert.strictEqual(result.staged, true);
  assert(Array.isArray(result.changedFiles));
}

async function testGetChangedFilesSince() {
  const result = await getChangedFiles(REPO_ROOT, { since: 'HEAD~1' });
  assert.strictEqual(result.ok, true);
  assert(Array.isArray(result.changedFiles));
  assert(result.since === 'HEAD~1' || result.since === undefined);
}

async function testGetChangedFilesCommits() {
  const result = await getChangedFiles(REPO_ROOT, { commits: 'HEAD~1..HEAD' });
  assert.strictEqual(result.ok, true);
  assert(Array.isArray(result.changedFiles));
  assert.strictEqual(result.commits, 'HEAD~1..HEAD');
}

async function testGetChangedFilesWithUntracked() {
  const result = await getChangedFiles(REPO_ROOT, { includeUntracked: true });
  assert.strictEqual(result.ok, true);
  assert(Array.isArray(result.changedFiles));
}

async function testGetChangedLineRanges() {
  const result = await getChangedLineRanges(REPO_ROOT, 'cli.js', { staged: false });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.file, 'cli.js');
  assert(Array.isArray(result.lineRanges));
}

async function testGetFileHistoryRisk() {
  const result = await getFileHistoryRisk(REPO_ROOT, 'cli.js', { limit: 5 });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.file, 'cli.js');
  assert(result.historyRisk);
  assert(typeof result.historyRisk.score === 'number');
  assert(typeof result.historyRisk.level === 'string');
  assert(Array.isArray(result.recentCommits));
  assert(result.recentCommits.length <= 5);
}

async function testGetDiffNumstat() {
  const result = await getDiffNumstat(REPO_ROOT, { staged: false });
  assert.strictEqual(result.ok, true);
  assert(Array.isArray(result.files));
  assert(typeof result.totalAdditions === 'number');
  assert(typeof result.totalDeletions === 'number');
}

function testParsePorcelainV1Line() {
  // Normal modified file
  const m = parsePorcelainV1Line(' M src/index.js');
  assert.strictEqual(m.indexStatus, ' ');
  assert.strictEqual(m.workTreeStatus, 'M');
  assert.strictEqual(m.path, 'src/index.js');
  assert.strictEqual(m.isUntracked, false);
  assert.strictEqual(m.isStaged, false);
  assert.strictEqual(m.isUnstaged, true);
  assert.strictEqual(m.renamedFrom, null);

  // Staged added file
  const a = parsePorcelainV1Line('A  src/new.js');
  assert.strictEqual(a.indexStatus, 'A');
  assert.strictEqual(a.workTreeStatus, ' ');
  assert.strictEqual(a.path, 'src/new.js');
  assert.strictEqual(a.isStaged, true);
  assert.strictEqual(a.isUnstaged, false);

  // Untracked file
  const u = parsePorcelainV1Line('?? untracked.md');
  assert.strictEqual(u.indexStatus, '?');
  assert.strictEqual(u.workTreeStatus, '?');
  assert.strictEqual(u.path, 'untracked.md');
  assert.strictEqual(u.isUntracked, true);
  assert.strictEqual(u.isStaged, false);
  assert.strictEqual(u.isUnstaged, true);

  // Renamed file
  const r = parsePorcelainV1Line('R  old.js -> new.js');
  assert.strictEqual(r.indexStatus, 'R');
  assert.strictEqual(r.workTreeStatus, ' ');
  assert.strictEqual(r.path, 'new.js');
  assert.strictEqual(r.renamedFrom, 'old.js');
  assert.strictEqual(r.isStaged, true);

  // File with spaces in name
  const s = parsePorcelainV1Line(' M file with spaces.js');
  assert.strictEqual(s.path, 'file with spaces.js');

  // Edge cases
  assert.strictEqual(parsePorcelainV1Line(''), null);
  assert.strictEqual(parsePorcelainV1Line('M'), null);
  assert.strictEqual(parsePorcelainV1Line('M src'), null); // missing space separator
  assert.strictEqual(parsePorcelainV1Line('?? '), null); // empty path
}

async function main() {
  await testGetChangedFilesStaged();
  await testGetChangedFilesSince();
  await testGetChangedFilesCommits();
  await testGetChangedFilesWithUntracked();
  await testGetChangedLineRanges();
  await testGetFileHistoryRisk();
  await testGetDiffNumstat();
  testParsePorcelainV1Line();
}

main();
