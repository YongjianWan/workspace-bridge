/**
 * Current commit of the repository that contains `root`, or null when there is none.
 *
 * A `git rev-parse HEAD` process costs 0.3–0.5 s on Windows and runs on every cold and warm
 * start, so ordinary repositories are answered by reading `.git/HEAD` and the ref it names.
 * Anything that file layout does not describe (linked worktrees and submodules where `.git`
 * is a file, GIT_DIR overrides, reftable, a ref that is neither loose nor packed) goes to git,
 * so the answer is the one git gives.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const TIMEOUTS = require('../config/timeouts');

const FULL_SHA = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/;
const REF_PREFIX = 'ref: ';

function findGitDirectory(root) {
  for (let dir = path.resolve(root); ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, '.git');
    let stat = null;
    try {
      stat = fs.statSync(candidate);
    } catch {
      // No .git at this level; keep climbing.
    }
    if (stat) return stat.isDirectory() ? candidate : null;
    if (path.dirname(dir) === dir) return null;
  }
}

function readPackedRef(gitDir, ref) {
  let packed;
  try {
    packed = fs.readFileSync(path.join(gitDir, 'packed-refs'), 'utf8');
  } catch {
    return null;
  }
  for (const line of packed.split(/\r?\n/)) {
    if (line.startsWith('#') || line.startsWith('^')) continue;
    const [sha, name] = line.split(' ');
    if (name === ref && FULL_SHA.test(sha)) return sha;
  }
  return null;
}

function readHeadFromFiles(root) {
  if (process.env.GIT_DIR || process.env.GIT_WORK_TREE) return null;
  const gitDir = findGitDirectory(root);
  if (!gitDir) return null;
  let head;
  try {
    head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
  } catch {
    return null;
  }
  if (FULL_SHA.test(head)) return head;
  if (!head.startsWith(REF_PREFIX)) return null;
  const ref = head.slice(REF_PREFIX.length);
  if (ref.includes('..')) return null;
  try {
    const loose = fs.readFileSync(path.join(gitDir, ...ref.split('/')), 'utf8').trim();
    if (FULL_SHA.test(loose)) return loose;
  } catch {
    // Not a loose ref; it may be packed.
  }
  return readPackedRef(gitDir, ref);
}

function readHeadFromGit(root) {
  const timeout = TIMEOUTS.GIT_SHORT_MS;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      timeout,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null;
  } catch {
    // Not a repository, no commit yet, or git is not installed.
    return null;
  }
}

function readGitHead(root) {
  return readHeadFromFiles(root) || readHeadFromGit(root);
}

module.exports = { readGitHead };
