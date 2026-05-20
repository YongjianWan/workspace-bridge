/**
 * Git tools for workspace-bridge - SECURE VERSION
 * All commands use argument arrays to prevent injection
 */
const path = require('path');
const fs = require('fs');
const { findWorkspaceRoot, resolveWorkspaceFilePath, toRelativePosix } = require('../utils/path');
const { runGit, trimOutput } = require('../utils/command');
const { scoreToLevel } = require('../config/risk-thresholds');
const { TIMEOUTS, LIMITS } = require('../config/constants');

function parseIsoDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function diffDays(from, to) {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / msPerDay));
}

// 历史风险评分规则：组内 first-match，组间累加
const HISTORY_RISK_SCORE_GROUPS = [
  {
    name: 'commits',
    rules: [
      { check: (ctx) => ctx.commits.length >= 8, score: 3 },
      { check: (ctx) => ctx.commits.length >= 4, score: 2 },
      { check: (ctx) => ctx.commits.length >= 2, score: 1 },
    ],
  },
  {
    name: 'authors',
    rules: [
      { check: (ctx) => ctx.authors.size >= 3, score: 2 },
      { check: (ctx) => ctx.authors.size >= 2, score: 1 },
    ],
  },
  {
    name: 'freshness',
    rules: [
      { check: (ctx) => ctx.lastModifiedDaysAgo !== null && ctx.lastModifiedDaysAgo <= 7, score: 2 },
      { check: (ctx) => ctx.lastModifiedDaysAgo !== null && ctx.lastModifiedDaysAgo <= 30, score: 1 },
    ],
  },
  {
    name: 'reverts',
    rules: [
      { check: (ctx) => ctx.revertLikeCount > 0, score: 2 },
    ],
  },
];

function computeHistoryRisk(commits) {
  if (!Array.isArray(commits) || commits.length === 0) {
    return {
      level: 'low',
      score: 0,
      commitCount: 0,
      authorCount: 0,
      lastModifiedDaysAgo: null,
      revertLikeCount: 0,
      signals: ['No tracked history for this file.'],
    };
  }

  const authors = new Set(commits.map((commit) => commit.email || commit.author).filter(Boolean));
  const newestCommit = parseIsoDate(commits[0]?.date);
  const lastModifiedDaysAgo = newestCommit ? diffDays(newestCommit, new Date()) : null;
  const revertLikeCount = commits.filter((commit) => /\b(revert|rollback|roll back|hotfix)\b/i.test(commit.subject || '')).length;

  let score = 0;
  const ctx = { commits, authors, lastModifiedDaysAgo, revertLikeCount };
  for (const group of HISTORY_RISK_SCORE_GROUPS) {
    for (const rule of group.rules) {
      if (rule.check(ctx)) {
        score += rule.score;
        break;
      }
    }
  }

  const signals = [];
  if (commits.length >= 4) signals.push(`High churn: ${commits.length} commits in recent history window.`);
  if (authors.size >= 2) signals.push(`Multiple authors touched this file (${authors.size}).`);
  if (lastModifiedDaysAgo !== null && lastModifiedDaysAgo <= 7) signals.push(`Recently modified ${lastModifiedDaysAgo} day(s) ago.`);
  if (revertLikeCount > 0) signals.push(`Found ${revertLikeCount} revert/rollback-like commit(s).`);
  if (signals.length === 0) signals.push('History looks relatively quiet.');

  const level = scoreToLevel(score);

  return {
    level,
    score,
    commitCount: commits.length,
    authorCount: authors.size,
    lastModifiedDaysAgo,
    revertLikeCount,
    signals,
  };
}

async function ensureGitRepo(root) {
  const result = await runGit(['rev-parse', '--show-toplevel'], root, TIMEOUTS.GIT_SHORT_MS);
  if (!result.ok) {
    return { ok: false, error: 'Not a git repository', workspaceRoot: root };
  }
  return null;
}

function isCacheArtifact(filePath) {
  const base = path.basename(filePath);
  return base === 'cache.db'
    || base === 'cache.db-wal'
    || base === 'cache.db-shm';
}

/**
 * Parse a single line of `git status --porcelain=v1` output.
 * Isolates character-level parsing so the main loop only deals with
 * structured data.
 *
 * Format: XY PATH  or  XY ORIG_PATH -> PATH
 *   X = index status, Y = working tree status
 *   '??' = untracked
 *
 * Returns null for empty or malformed lines.
 */
function parsePorcelainV1Line(line) {
  if (!line || line.length < 4 || line[2] !== ' ') {
    return null;
  }

  const indexStatus = line[0];
  const workTreeStatus = line[1];
  let rawPath = line.slice(3);
  let renamedFrom = null;

  if (rawPath.includes(' -> ')) {
    const parts = rawPath.split(' -> ');
    renamedFrom = parts[0].trim();
    rawPath = parts[parts.length - 1].trim();
  }

  return {
    indexStatus,
    workTreeStatus,
    path: rawPath,
    renamedFrom,
    isUntracked: indexStatus === '?' && workTreeStatus === '?',
    isStaged: indexStatus !== ' ' && indexStatus !== '?',
    isUnstaged: workTreeStatus !== ' ',
  };
}

async function getChangedFiles(root, options = {}) {
  const staged = options.staged === true;
  const includeUntracked = options.includeUntracked !== false;
  const since = options.since || null;
  const gitCheck = await ensureGitRepo(root);
  if (gitCheck) return gitCheck;

  // Commit range mode: use git diff --name-only instead of git status
  if (since) {
    const result = await runGit(['diff', '--name-only', `${since}...HEAD`], root, TIMEOUTS.GIT_LONG_MS);
    if (!result.ok) {
      return { ok: false, error: result.stderr || `Failed to read git diff since ${since}`, workspaceRoot: root };
    }
    const files = new Set();
    for (const line of (result.stdout || '').split(/\r?\n/)) {
      const file = line.trim();
      if (!file) continue;
      if (isCacheArtifact(file)) continue;
      files.add(file);
    }
    return {
      ok: true,
      workspaceRoot: root,
      staged: false,
      since,
      changedFiles: Array.from(files),
    };
  }

  const args = ['status', '--porcelain=v1', includeUntracked ? '--untracked-files=all' : '--untracked-files=no'];

  const result = await runGit(args, root, TIMEOUTS.GIT_LONG_MS);
  if (!result.ok) {
    return { ok: false, error: result.stderr || 'Failed to read git status', workspaceRoot: root };
  }

  const files = new Set();
  for (const rawLine of (result.stdout || '').split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line) continue;

    const parsed = parsePorcelainV1Line(line);
    if (!parsed) continue;

    let file = parsed.path;
    if (!file) continue;

    // `git status` can return untracked directories like "src/new-dir/".
    // We only want file paths in audit-diff.
    if (parsed.isUntracked && (file.endsWith('/') || file.endsWith('\\'))) {
      continue;
    }

    if (staged) {
      if (parsed.isStaged && !isCacheArtifact(file)) files.add(file);
      continue;
    }

    if (parsed.isUntracked || parsed.isStaged || parsed.isUnstaged) {
      const absolute = resolveWorkspaceFilePath(file, root);
      if (absolute) {
        try {
          if (fs.existsSync(absolute) && fs.statSync(absolute).isDirectory()) {
            continue;
          }
        } catch {
          // Keep path when stat is unavailable (e.g., deleted file)
        }
      }
      if (isCacheArtifact(file)) continue;
      files.add(file);
    }
  }

  return {
    ok: true,
    workspaceRoot: root,
    staged,
    changedFiles: Array.from(files),
  };
}

function parseUnifiedDiffLineRanges(diffText) {
  const ranges = [];
  const hunkRegex = /^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,(\d+))?\s+@@/gm;
  let match;
  while ((match = hunkRegex.exec(diffText || '')) !== null) {
    const start = Number.parseInt(match[1], 10);
    const count = match[2] ? Number.parseInt(match[2], 10) : 1;
    if (!Number.isFinite(start) || !Number.isFinite(count) || count <= 0) continue;
    ranges.push({
      startLine: start,
      endLine: start + count - 1,
    });
  }
  return ranges;
}

async function isTrackedByGit(root, filePath) {
  const result = await runGit(['ls-files', '--error-unmatch', '--', filePath], root, TIMEOUTS.GIT_SHORT_MS);
  return result.ok;
}

async function getChangedLineRanges(root, file, options = {}) {
  const gitCheck = await ensureGitRepo(root);
  if (gitCheck) return gitCheck;

  const filePath = resolveWorkspaceFilePath(file, root);
  if (!filePath) {
    return { ok: false, error: 'Invalid file path or path outside workspace', workspaceRoot: root, file };
  }

  const staged = options.staged === true;
  const since = options.since || null;
  let diffArgs;
  if (since) {
    diffArgs = ['diff', '--no-color', '--unified=0', `${since}...HEAD`, '--', filePath];
  } else {
    diffArgs = staged
      ? ['diff', '--cached', '--no-color', '--unified=0', '--', filePath]
      : ['diff', '--no-color', '--unified=0', '--', filePath];
  }

  const diffResult = await runGit(diffArgs, root, TIMEOUTS.GIT_LONG_MS);
  const ranges = parseUnifiedDiffLineRanges(diffResult.stdout || '');
  if (ranges.length > 0) {
    return {
      ok: true,
      workspaceRoot: root,
      file: toRelativePosix(root, filePath),
      staged,
      lineRanges: ranges,
      source: 'diff',
    };
  }

  // New untracked file may not appear in git diff output. Fallback only for unstaged.
  if (!staged) {
    const tracked = await isTrackedByGit(root, filePath);
    if (!tracked && fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split(/\r?\n/).length;
        return {
          ok: true,
          workspaceRoot: root,
          file: toRelativePosix(root, filePath),
          staged,
          lineRanges: lines > 0 ? [{ startLine: 1, endLine: lines }] : [],
          source: 'untracked-file',
        };
      } catch {
        return {
          ok: true,
          workspaceRoot: root,
          file: toRelativePosix(root, filePath),
          staged,
          lineRanges: [],
          source: 'untracked-file',
        };
      }
    }
  }

  return {
    ok: true,
    workspaceRoot: root,
    file: toRelativePosix(root, filePath),
    staged,
    lineRanges: [],
    source: 'diff',
  };
}

async function getFileHistoryRisk(root, file, options = {}) {
  const gitCheck = await ensureGitRepo(root);
  if (gitCheck) return gitCheck;

  const filePath = resolveWorkspaceFilePath(file, root);
  if (!filePath) {
    return { ok: false, error: 'Invalid file path or path outside workspace', workspaceRoot: root };
  }

  const limit = Number.isFinite(options.limit) ? Math.min(Math.max(options.limit, 1), LIMITS.GIT_COMMIT_MAX) : 25;
  const fmt = '--format=%x00%H%n%an%n%ae%n%ai%n%s';
  const result = await runGit(['log', '--follow', `-${limit}`, fmt, '--', filePath], root, TIMEOUTS.GIT_LONG_MS);
  if (!result.ok && !result.stdout) {
    return { ok: false, error: result.stderr || 'Failed to read git history', workspaceRoot: root, file };
  }

  const commits = [];
  for (const block of (result.stdout || '').split('\0')) {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
    if (lines.length >= 5) {
      commits.push({
        hash: lines[0],
        author: lines[1],
        email: lines[2],
        date: lines[3],
        subject: lines[4],
      });
    }
  }

  return {
    ok: true,
    workspaceRoot: root,
    file: toRelativePosix(root, filePath),
    historyRisk: computeHistoryRisk(commits),
    recentCommits: commits.slice(0, LIMITS.GIT_COMMIT_MAX),
  };
}

async function getDiffNumstat(root, options = {}) {
  const gitCheck = await ensureGitRepo(root);
  if (gitCheck) return gitCheck;

  const since = options.since || null;
  const args = ['diff', '--numstat'];
  if (since) {
    args.push(`${since}...HEAD`);
  } else if (options.staged) {
    args.push('--cached');
  }
  if (options.includeUntracked && !since) {
    args.push('--', '.');
  }

  const result = await runGit(args, root, TIMEOUTS.GIT_LONG_MS);
  if (!result.ok) {
    return { ok: false, error: result.stderr || 'Failed to read diff numstat', workspaceRoot: root };
  }

  const files = [];
  let totalAdditions = 0;
  let totalDeletions = 0;

  for (const line of (result.stdout || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split('\t');
    if (parts.length < 3) continue;
    const added = parts[0] === '-' ? 0 : Number.parseInt(parts[0], 10);
    const removed = parts[1] === '-' ? 0 : Number.parseInt(parts[1], 10);
    const file = parts[2];
    if (!Number.isFinite(added) || !Number.isFinite(removed)) continue;
    files.push({ file, added, removed });
    totalAdditions += added;
    totalDeletions += removed;
  }

  return {
    ok: true,
    workspaceRoot: root,
    staged: Boolean(options.staged),
    since,
    files,
    totalAdditions,
    totalDeletions,
  };
}

module.exports = {
  getChangedFiles,
  getChangedLineRanges,
  getFileHistoryRisk,
  getDiffNumstat,
  // Exposed for unit testing porcelain parser edge cases
  parsePorcelainV1Line,
};
