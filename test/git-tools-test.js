// @semantic
const assert = require('assert');
const path = require('path');
const { getChangedFiles, getChangedLineRanges, getFileHistoryRisk, getDiffNumstat, parsePorcelainV1Line, isCacheArtifact } = require('../src/tools/git-tools');

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
  assert(typeof result.historyRisk.score === 'number' && result.historyRisk.score >= 0, 'score should be a non-negative number');
  assert.ok(['low', 'medium', 'high'].includes(result.historyRisk.level), `level should be low, medium, or high, got: ${result.historyRisk.level}`);
  assert(Array.isArray(result.recentCommits));
  assert(result.recentCommits.length <= 5);
  for (const c of result.recentCommits) {
    assert.strictEqual(typeof c.hash, 'string', 'commit hash should be string');
    assert.ok(/^[0-9a-f]{40}$/.test(c.hash), 'commit hash should be 40-char SHA-1 hex string');
    assert.strictEqual(typeof c.author, 'string', 'commit author should be string');
    assert.ok(c.author.length > 0, 'commit author should not be empty');
    assert.strictEqual(typeof c.email, 'string', 'commit email should be string');
    assert.ok(c.email.includes('@'), 'commit email should contain @');
    assert.strictEqual(typeof c.date, 'string', 'commit date should be string');
    assert.strictEqual(typeof c.subject, 'string', 'commit subject should be string');
    assert.ok(c.subject.length > 0, 'commit subject should not be empty');
  }
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

function testIsCacheArtifact() {
  // Basename checks (preserved for backward compatibility)
  assert.strictEqual(isCacheArtifact('cache.db'), true);
  assert.strictEqual(isCacheArtifact('cache.db-wal'), true);
  assert.strictEqual(isCacheArtifact('cache.db-shm'), true);
  assert.strictEqual(isCacheArtifact('src/cache.db'), true);

  // Any file inside a .workspace-bridge/ directory should be filtered,
  // including lock files and other artifacts that share cache.db basenames.
  assert.strictEqual(isCacheArtifact('.workspace-bridge/lock'), true);
  assert.strictEqual(isCacheArtifact('.workspace-bridge/cache.db'), true);
  assert.strictEqual(isCacheArtifact('.workspace-bridge/any-file.txt'), true);
  assert.strictEqual(isCacheArtifact('path/to/.workspace-bridge/artifact.lock'), true);
  assert.strictEqual(isCacheArtifact('C:\\Users\\project\\.workspace-bridge\\lock'), true);

  // Negative cases
  assert.strictEqual(isCacheArtifact('foo.workspace-bridge/file.txt'), false);
  assert.strictEqual(isCacheArtifact('src/cache.db.bak'), false);
  assert.strictEqual(isCacheArtifact('readme.md'), false);
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
  testIsCacheArtifact();
}

main();
