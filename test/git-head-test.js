#!/usr/bin/env node
// @fast
// @semantic
/**
 * readGitHead answers what `git rev-parse HEAD` answers, for every repository shape, and
 * answers null where git fails (no repository, no commit yet).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');
const { readGitHead } = require('../src/utils/git-head');

function git(cwd, args) {
  const r = spawnSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=t', '-c', 'user.email=t@t.t', ...args], { cwd, encoding: 'utf8', timeout: 30000 });
  assert.strictEqual(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function expectSame(dir, label) {
  assert.strictEqual(readGitHead(dir), git(dir, ['rev-parse', 'HEAD']), label);
}

const base = makeTempDir('wb-git-head-');
try {
  // Not a repository, and a repository without a commit.
  const plain = path.join(base, 'plain');
  fs.mkdirSync(plain);
  assert.strictEqual(readGitHead(plain), null, 'no repository');
  const empty = path.join(base, 'empty');
  fs.mkdirSync(empty);
  git(empty, ['init', '-q']);
  assert.strictEqual(readGitHead(empty), null, 'repository without a commit');

  const repo = path.join(base, 'repo');
  fs.mkdirSync(path.join(repo, 'sub', 'deep'), { recursive: true });
  git(repo, ['init', '-q']);
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-qm', 'one']);
  expectSame(repo, 'branch with loose ref');
  expectSame(path.join(repo, 'sub', 'deep'), 'workspace in a subdirectory');

  fs.writeFileSync(path.join(repo, 'b.txt'), 'b');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-qm', 'two']);
  expectSame(repo, 'HEAD moves with a new commit');

  git(repo, ['pack-refs', '--all']);
  expectSame(repo, 'branch whose ref lives in packed-refs');

  git(repo, ['checkout', '-q', '--detach', 'HEAD~1']);
  expectSame(repo, 'detached HEAD');

  git(repo, ['checkout', '-q', '-b', 'feature/x']);
  expectSame(repo, 'branch name with a slash');

  // A linked worktree keeps its repository data elsewhere (.git is a file).
  const wt = path.join(base, 'wt');
  git(repo, ['worktree', 'add', '-q', wt, '-b', 'wtbranch']);
  expectSame(wt, 'linked worktree');
} finally {
  cleanupTempDir(base);
}
