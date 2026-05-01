/**
 * Git tools for workspace-bridge - SECURE VERSION
 * All commands use argument arrays to prevent injection
 */
const path = require('path');
const fs = require('fs');
const { findWorkspaceRoot, normalizePath, isPathInsideRoot, toRelativePosix } = require('../utils/path');
const { runGit, trimOutput } = require('../utils/command');
const { scoreToLevel } = require('../config/risk-thresholds');

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

/**
 * Validate that a file path is within the workspace root (prevent path traversal)
 * @param {string} filePath - Path to validate
 * @param {string} root - Workspace root
 * @returns {string|null} - Normalized path if valid, null otherwise
 */
function validateWorkspacePath(filePath, root) {
  if (!filePath || typeof filePath !== 'string') return null;

  const resolved = path.isAbsolute(filePath)
    ? normalizePath(filePath)
    : normalizePath(path.join(root, filePath));

  if (!isPathInsideRoot(root, resolved)) {
    return null;
  }

  return resolved;
}

async function ensureGitRepo(root) {
  const result = await runGit(['rev-parse', '--show-toplevel'], root, 15000);
  if (!result.ok) {
    return { ok: false, error: 'Not a git repository', workspaceRoot: root };
  }
  return null;
}

async function gitDiffSummary(args, container) {
  const target = args?.cwd || process.cwd();
  const root = container?.workspaceRoot || findWorkspaceRoot(target);
  const staged = Boolean(args?.staged);

  const gitCheck = await ensureGitRepo(root);
  if (gitCheck) return gitCheck;

  const diffArgs = staged ? ['diff', '--cached', '--no-color'] : ['diff', '--no-color'];

  const [stat, names, patch] = await Promise.all([
    runGit([...diffArgs, '--stat'], root, 30000),
    runGit([...diffArgs, '--name-only'], root, 30000),
    runGit([...diffArgs, '--unified=0'], root, 30000),
  ]);

  return {
    workspaceRoot: root,
    inGitRepo: true,
    staged,
    files: names.stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean),
    stat: trimOutput(stat.stdout, 8000),
    patch: trimOutput(patch.stdout, 12000),
  };
}

function isTempFile(filePath) {
  const base = path.basename(filePath);
  return /^\.tmp-/.test(base) || /\.workspace-bridge-cache\.json\.tmp-/.test(base);
}

async function getChangedFiles(root, options = {}) {
  const staged = options.staged === true;
  const includeUntracked = options.includeUntracked !== false;
  const gitCheck = await ensureGitRepo(root);
  if (gitCheck) return gitCheck;

  const args = ['status', '--porcelain=v1', includeUntracked ? '--untracked-files=all' : '--untracked-files=no'];

  const result = await runGit(args, root, 30000);
  if (!result.ok) {
    return { ok: false, error: result.stderr || 'Failed to read git status', workspaceRoot: root };
  }

  const files = new Set();
  for (const rawLine of (result.stdout || '').split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line) continue;

    const x = line[0];
    const y = line[1];
    let file = line.slice(3).trim();
    if (!file) continue;

    if (file.includes(' -> ')) {
      file = file.split(' -> ').pop().trim();
    }

    const isUntracked = x === '?' && y === '?';
    const isStaged = x !== ' ' && x !== '?';
    const isUnstaged = y !== ' ';

    // `git status` can return untracked directories like "src/new-dir/".
    // We only want file paths in audit-diff.
    if (isUntracked && (file.endsWith('/') || file.endsWith('\\'))) {
      continue;
    }

    if (staged) {
      if (isStaged && !isTempFile(file)) files.add(file);
      continue;
    }

    if (isUntracked || isStaged || isUnstaged) {
      const absolute = validateWorkspacePath(file, root);
      if (absolute) {
        try {
          if (fs.existsSync(absolute) && fs.statSync(absolute).isDirectory()) {
            continue;
          }
        } catch {
          // Keep path when stat is unavailable (e.g., deleted file)
        }
      }
      if (isTempFile(file)) continue;
      if (path.basename(file) === '.workspace-bridge-cache.json') continue;
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
  const result = await runGit(['ls-files', '--error-unmatch', '--', filePath], root, 15000);
  return result.ok;
}

async function getChangedLineRanges(root, file, options = {}) {
  const gitCheck = await ensureGitRepo(root);
  if (gitCheck) return gitCheck;

  const filePath = validateWorkspacePath(file, root);
  if (!filePath) {
    return { ok: false, error: 'Invalid file path or path outside workspace', workspaceRoot: root, file };
  }

  const staged = options.staged === true;
  const diffArgs = staged
    ? ['diff', '--cached', '--no-color', '--unified=0', '--', filePath]
    : ['diff', '--no-color', '--unified=0', '--', filePath];

  const diffResult = await runGit(diffArgs, root, 30000);
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

  const filePath = validateWorkspacePath(file, root);
  if (!filePath) {
    return { ok: false, error: 'Invalid file path or path outside workspace', workspaceRoot: root };
  }

  const limit = Number.isFinite(options.limit) ? Math.min(Math.max(options.limit, 1), 100) : 25;
  const fmt = '--format=%x00%H%n%an%n%ae%n%ai%n%s';
  const result = await runGit(['log', '--follow', `-${limit}`, fmt, '--', filePath], root, 30000);
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
    recentCommits: commits.slice(0, 10),
  };
}

async function gitBlame(args, container) {
  const target = args?.cwd || process.cwd();
  const root = container?.workspaceRoot || findWorkspaceRoot(target);
  const file = args?.file;

  if (!file) return { ok: false, error: 'file parameter is required' };

  // Validate path is within workspace
  const filePath = validateWorkspacePath(file, root);
  if (!filePath) {
    return { ok: false, error: 'Invalid file path or path outside workspace' };
  }

  // Check file exists
  try {
    const fs = require('fs');
    if (!fs.existsSync(filePath)) {
      return { ok: false, error: `File not found: ${filePath}` };
    }
  } catch (e) {
    return { ok: false, error: `Cannot access file: ${filePath}` };
  }

  const gitCheck = await ensureGitRepo(root);
  if (gitCheck) return gitCheck;

  // Build blame arguments securely
  const blameArgs = ['blame', '--line-porcelain'];
  
  // Validate and add line range
  if (Number.isFinite(args?.startLine) && args.startLine > 0) {
    const endLine = Number.isFinite(args?.endLine) && args.endLine >= args.startLine 
      ? args.endLine 
      : args.startLine;
    blameArgs.push('-L', `${args.startLine},${endLine}`);
  }
  
  blameArgs.push(filePath);

  const result = await runGit(blameArgs, root, 30000);
  if (!result.ok && !result.stdout) {
    return { ok: false, error: result.stderr, workspaceRoot: root };
  }

  const entries = [];
  let current = null;
  for (const line of result.stdout.split('\n')) {
    if (/^[0-9a-f]{40}/.test(line)) {
      const parts = line.split(' ');
      current = {
        hash: parts[0],
        originalLine: parseInt(parts[1], 10),
        finalLine: parseInt(parts[2], 10),
      };
    } else if (current) {
      if (line.startsWith('author ')) current.author = line.slice(7);
      else if (line.startsWith('author-time ')) current.authorTime = new Date(parseInt(line.slice(12), 10) * 1000).toISOString();
      else if (line.startsWith('summary ')) current.summary = line.slice(8);
      else if (line.startsWith('\t')) {
        current.content = line.slice(1);
        entries.push(current);
        current = null;
      }
    }
  }

  return {
    ok: true,
    workspaceRoot: root,
    file: toRelativePosix(root, filePath),
    entryCount: entries.length,
    entries: entries.slice(0, 500),
  };
}

async function gitHistory(args, container) {
  const target = args?.cwd || process.cwd();
  const root = container?.workspaceRoot || findWorkspaceRoot(target);
  const limit = Number.isFinite(args?.limit) ? Math.min(args.limit, 200) : 30;

  const gitCheck = await ensureGitRepo(root);
  if (gitCheck) return gitCheck;

  // Build log arguments securely
  const logArgs = ['log', `-${limit}`];
  
  // Add optional filters with validation
  if (args?.author && typeof args.author === 'string' && args.author.length < 100) {
    // Sanitize author - only allow reasonable characters
    const sanitizedAuthor = args.author.replace(/[<>\"\x00-\x1f]/g, '');
    if (sanitizedAuthor) {
      logArgs.push('--author', sanitizedAuthor);
    }
  }
  
  if (args?.since && typeof args.since === 'string' && args.since.length < 50) {
    // Basic date format validation
    const sanitizedSince = args.since.replace(/[;|&$`\n\r]/g, '');
    if (sanitizedSince) {
      logArgs.push('--since', sanitizedSince);
    }
  }
  
  if (args?.until && typeof args.until === 'string' && args.until.length < 50) {
    const sanitizedUntil = args.until.replace(/[;|&$`\n\r]/g, '');
    if (sanitizedUntil) {
      logArgs.push('--until', sanitizedUntil);
    }
  }

  // Add file filter if specified (validate path)
  if (args?.file) {
    const filePath = validateWorkspacePath(args.file, root);
    if (filePath) {
      logArgs.push('--', filePath);
    }
  }

  // Format: null-separated fields
  const fmt = '--format=%x00%H%n%h%n%an%n%ae%n%ai%n%s';
  logArgs.push(fmt);

  const result = await runGit(logArgs, root, 30000);
  const commits = [];

  for (const block of (result.stdout || '').split('\0')) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length >= 6) {
      commits.push({
        hash: lines[0],
        shortHash: lines[1],
        author: lines[2],
        email: lines[3],
        date: lines[4],
        subject: lines[5],
      });
    }
  }

  return {
    ok: true,
    workspaceRoot: root,
    limit,
    file: args?.file || null,
    commitCount: commits.length,
    commits,
  };
}

async function gitBranchInfo(args) {
  const target = args?.cwd || process.cwd();
  const root = findWorkspaceRoot(target);

  const gitCheck = await ensureGitRepo(root);
  if (gitCheck) return gitCheck;

  // --show-current requires Git 2.22+, fallback to rev-parse
  let current = await runGit(['branch', '--show-current'], root, 15000);
  if (!current.ok) {
    current = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], root, 15000);
  }

  // --format requires Git 2.7+, fallback to -v -a parsing
  const formatResult = await runGit(
    ['branch', '-a', '--format=%(refname:short)|%(upstream:short)|%(upstream:track)|%(objectname:short)'],
    root, 15000
  );

  const branches = [];
  if (formatResult.ok && formatResult.stdout.trim()) {
    for (const line of formatResult.stdout.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split('|');
      branches.push({
        name: parts[0] || '',
        upstream: parts[1] || null,
        tracking: parts[2] || null,
        hash: parts[3] || null,
      });
    }
  } else {
    // Git < 2.7 fallback: parse `git branch -v -a`
    const fallback = await runGit(['branch', '-v', '-a'], root, 15000);
    if (fallback.ok && fallback.stdout.trim()) {
      for (const line of fallback.stdout.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        // "* main  abc1234 commit msg" or "  dev  def5678 commit msg"
        const m = trimmed.match(/^\*?\s*(\S+)\s+([0-9a-f]+)\s/);
        if (m) {
          branches.push({
            name: m[1],
            upstream: null,
            tracking: null,
            hash: m[2],
          });
        }
      }
    }
  }

  const statusResult = await runGit(['status', '--porcelain=v1'], root, 15000);
  const modifiedLines = (statusResult.stdout || '').split('\n').filter(l => l.trim());

  return {
    ok: true,
    workspaceRoot: root,
    currentBranch: (current.stdout || '').trim(),
    branchCount: branches.length,
    branches,
    workingTreeClean: modifiedLines.length === 0,
    modifiedFilesCount: modifiedLines.length,
  };
}

async function gitStash(args) {
  const target = args?.cwd || process.cwd();
  const root = findWorkspaceRoot(target);
  const action = args?.action || 'list';

  const gitCheck = await ensureGitRepo(root);
  if (gitCheck) return gitCheck;

  if (action === 'list') {
    const result = await runGit(['stash', 'list'], root, 15000);
    const stashes = (result.stdout || '')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const m = line.match(/^stash@\{(\d+)\}:\s+(.+)$/);
        return m ? { index: parseInt(m[1], 10), description: m[2] } : { raw: line };
      });
    return { ok: true, workspaceRoot: root, action, stashCount: stashes.length, stashes };
  }

  if (action === 'show') {
    const index = Number.isFinite(args?.index) && args.index >= 0 ? args.index : 0;
    const result = await runGit(['stash', 'show', '-p', `stash@{${index}}`], root, 30000);
    return {
      ok: result.ok,
      workspaceRoot: root,
      action,
      index,
      patch: trimOutput(result.stdout, 8000),
      stderr: result.stderr,
    };
  }

  return { ok: false, error: `Unknown action: ${action}. Valid: 'list', 'show'.` };
}

async function gitLogGraph(args) {
  const target = args?.cwd || process.cwd();
  const root = findWorkspaceRoot(target);
  const limit = Number.isFinite(args?.limit) ? Math.min(args.limit, 100) : 30;

  const gitCheck = await ensureGitRepo(root);
  if (gitCheck) return gitCheck;

  const logArgs = ['log', '--graph', '--oneline', '--decorate', `-${limit}`];
  if (args?.allBranches) {
    logArgs.push('--all');
  }

  const result = await runGit(logArgs, root, 30000);

  return {
    ok: result.ok,
    workspaceRoot: root,
    limit,
    allBranches: Boolean(args?.allBranches),
    graph: trimOutput(result.stdout, 8000),
  };
}

module.exports = {
  gitDiffSummary,
  getChangedFiles,
  getChangedLineRanges,
  getFileHistoryRisk,
  gitBlame,
  gitHistory,
  gitBranchInfo,
  gitStash,
  gitLogGraph,
  validateWorkspacePath,  // Export for testing
};
