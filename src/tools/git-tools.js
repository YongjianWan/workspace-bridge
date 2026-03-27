/**
 * Git tools for workspace-bridge
 */
const path = require('path');
const { findWorkspaceRoot } = require('../utils/path');
const { runGit, trimOutput } = require('../utils/command');

function ensureGitRepo(root) {
  const gitRoot = runGit('rev-parse --show-toplevel', root, 15000);
  if (!gitRoot.ok) {
    return { ok: false, error: 'Not a git repository', workspaceRoot: root };
  }
  return null;
}

function gitDiffSummary(args) {
  const target = args?.cwd || process.cwd();
  const root = findWorkspaceRoot(target);
  const staged = Boolean(args?.staged);
  const diffArgs = staged ? 'diff --cached --no-color' : 'diff --no-color';

  const gitCheck = ensureGitRepo(root);
  if (gitCheck) return gitCheck;

  const stat = runGit(`${diffArgs} --stat`, root, 30000);
  const names = runGit(`${diffArgs} --name-only`, root, 30000);
  const patch = runGit(`${diffArgs} --unified=0`, root, 30000);

  return {
    workspaceRoot: root,
    inGitRepo: true,
    staged,
    files: names.stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean),
    stat: trimOutput(stat.stdout, 8000),
    patch: trimOutput(patch.stdout, 12000),
  };
}

function gitBlame(args) {
  const target = args?.cwd || process.cwd();
  const root = findWorkspaceRoot(target);
  const file = args?.file;

  if (!file) return { ok: false, error: 'file parameter is required' };

  const filePath = path.isAbsolute(file) ? file : path.resolve(root, file);
  if (!require('../utils/path').pathExists(filePath)) {
    return { ok: false, error: `File not found: ${filePath}` };
  }

  const gitCheck = ensureGitRepo(root);
  if (gitCheck) return gitCheck;

  let lineRange = '';
  if (Number.isFinite(args?.startLine)) {
    const end = Number.isFinite(args?.endLine) ? args.endLine : args.startLine;
    lineRange = ` -L ${args.startLine},${end}`;
  }

  const result = runGit(`blame --line-porcelain${lineRange} "${filePath}"`, root, 30000);
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
    file: path.relative(root, filePath),
    entryCount: entries.length,
    entries: entries.slice(0, 500),
  };
}

function gitHistory(args) {
  const target = args?.cwd || process.cwd();
  const root = findWorkspaceRoot(target);
  const limit = Number.isFinite(args?.limit) ? Math.min(args.limit, 200) : 30;

  const gitCheck = ensureGitRepo(root);
  if (gitCheck) return gitCheck;

  const fileArg = args?.file ? `"${path.isAbsolute(args.file) ? args.file : path.resolve(root, args.file)}"` : '';
  const authorArg = args?.author ? `--author="${args.author}"` : '';
  const sinceArg = args?.since ? `--since="${args.since}"` : '';
  const untilArg = args?.until ? `--until="${args.until}"` : '';

  const fmt = '--format=%x00%H%n%h%n%an%n%ae%n%ai%n%s';
  const logArgs = `log -${limit} ${authorArg} ${sinceArg} ${untilArg} ${fmt} -- ${fileArg}`.trim().replace(/\s+/g, ' ');

  const result = runGit(logArgs, root, 30000);
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

function gitBranchInfo(args) {
  const target = args?.cwd || process.cwd();
  const root = findWorkspaceRoot(target);

  const gitCheck = ensureGitRepo(root);
  if (gitCheck) return gitCheck;

  // --show-current requires Git 2.22+, fallback to rev-parse
  let current = runGit('branch --show-current', root, 15000);
  if (!current.ok) {
    current = runGit('rev-parse --abbrev-ref HEAD', root, 15000);
  }

  // --format requires Git 2.7+, fallback to -v -a parsing
  const formatResult = runGit(
    'branch -a --format=%(refname:short)|%(upstream:short)|%(upstream:track)|%(objectname:short)',
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
    const fallback = runGit('branch -v -a', root, 15000);
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

  const statusResult = runGit('status --porcelain=v1', root, 15000);
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

function gitStash(args) {
  const target = args?.cwd || process.cwd();
  const root = findWorkspaceRoot(target);
  const action = args?.action || 'list';

  const gitCheck = ensureGitRepo(root);
  if (gitCheck) return gitCheck;

  if (action === 'list') {
    const result = runGit('stash list', root, 15000);
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
    const index = Number.isFinite(args?.index) ? args.index : 0;
    const result = runGit(`stash show -p stash@{${index}}`, root, 30000);
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

function gitLogGraph(args) {
  const target = args?.cwd || process.cwd();
  const root = findWorkspaceRoot(target);
  const limit = Number.isFinite(args?.limit) ? Math.min(args.limit, 100) : 30;
  const allFlag = args?.allBranches ? '--all' : '';

  const gitCheck = ensureGitRepo(root);
  if (gitCheck) return gitCheck;

  const logArgs = `log --graph --oneline --decorate -${limit} ${allFlag}`.trim().replace(/\s+/g, ' ');
  const result = runGit(logArgs, root, 30000);

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
  gitBlame,
  gitHistory,
  gitBranchInfo,
  gitStash,
  gitLogGraph,
};
