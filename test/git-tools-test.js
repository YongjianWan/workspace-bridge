const assert = require('assert');
const path = require('path');
const { getChangedFiles, getChangedLineRanges, getFileHistoryRisk, getDiffNumstat } = require('../src/tools/git-tools');

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

async function main() {
  await testGetChangedFilesStaged();
  await testGetChangedFilesSince();
  await testGetChangedFilesWithUntracked();
  await testGetChangedLineRanges();
  await testGetFileHistoryRisk();
  await testGetDiffNumstat();
}

main();
