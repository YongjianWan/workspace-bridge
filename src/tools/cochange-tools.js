/**
 * Co-change analysis — files frequently changed in the same commit.
 * Ported from qartez-mcp git/cochange.rs heuristic.
 */
const { spawnSync } = require('child_process');
const { DATA_QUALITY, REMEDIATION } = require('../config/data-quality');

const DEFAULT_CONFIG = {
  commitLimit: 300,
  minFiles: 2,
  maxFiles: 20,
  minCount: 2,
  partnerLimit: 10,
};

/**
 * Walk recent git history and count file-pair co-occurrences per commit.
 *
 * Uses a single `git log --name-only` invocation instead of per-commit
 * `git diff-tree` to avoid N× shell overhead. Uses `git -C` instead of
 * `cwd` option to work around Windows ENOENT on paths containing CJK
 * characters (Node child_process cwd encoding issue).
 *
 * @param {string} workspaceRoot
 * @param {{commitLimit?: number, minFiles?: number, maxFiles?: number}} [options]
 * @returns {{pairCounts: Map<string, number>, fileChangeCounts: Map<string, number>, commitCount: number}}
 */
function analyzeCoChanges(workspaceRoot, options = {}) {
  const config = { ...DEFAULT_CONFIG, ...options };

  const result = spawnSync(
    'git',
    ['-C', workspaceRoot, 'log', '--format=%H', '--name-only', '--no-merges', '-n', String(config.commitLimit)],
    { encoding: 'utf8' }
  );

  if (result.error || result.status !== 0) {
    return {
      pairCounts: new Map(),
      fileChangeCounts: new Map(),
      commitCount: 0,
      dataQuality: DATA_QUALITY.UNAVAILABLE,
      remediation: null,
    };
  }

  // Detect shallow clone once — the environment fact, not a symptom heuristic.
  // `git rev-parse --is-shallow-repository` prints "true" or "false" (git ≥2.15);
  // older git or non-git dirs return non-zero, which we treat as non-shallow.
  const shallowResult = spawnSync(
    'git',
    ['-C', workspaceRoot, 'rev-parse', '--is-shallow-repository'],
    { encoding: 'utf8' }
  );
  const isShallow = shallowResult.status === 0 && shallowResult.stdout.trim() === 'true';

  const pairCounts = new Map();       // "a|b" -> count
  const fileChangeCounts = new Map(); // file -> count
  let commitCount = 0;
  let currentFiles = [];

  // Parse line-by-line: 40-char hex = new commit; non-empty line = file; empty = separator
  const lines = result.stdout.split('\n');
  for (const line of lines) {
    if (/^[a-f0-9]{40}$/i.test(line)) {
      // New commit encountered — finalize previous batch
      if (currentFiles.length > 0) {
        commitCount++;
        _accumulate(currentFiles, pairCounts, fileChangeCounts, config);
        currentFiles = [];
      }
      continue;
    }
    if (line) {
      currentFiles.push(line);
    }
  }

  // Finalize last commit (output may not end with a hash line)
  if (currentFiles.length > 0) {
    commitCount++;
    _accumulate(currentFiles, pairCounts, fileChangeCounts, config);
  }

  return {
    pairCounts,
    fileChangeCounts,
    commitCount,
    dataQuality: isShallow ? DATA_QUALITY.DEGRADED : DATA_QUALITY.CERTAIN,
    remediation: isShallow ? REMEDIATION.SHALLOW_CLONE : null,
  };
}

function _accumulate(files, pairCounts, fileChangeCounts, config) {
  if (files.length < config.minFiles || files.length > config.maxFiles) {
    return;
  }
  for (let i = 0; i < files.length; i++) {
    const fi = files[i];
    fileChangeCounts.set(fi, (fileChangeCounts.get(fi) || 0) + 1);
    for (let j = i + 1; j < files.length; j++) {
      const fj = files[j];
      const key = fi < fj ? `${fi}|${fj}` : `${fj}|${fi}`;
      pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
    }
  }
}

/**
 * Get top co-change partners for a given file.
 *
 * @param {string} filePath — relative path within workspace
 * @param {{pairCounts: Map<string, number>}} coChangeData
 * @param {{minCount?: number, partnerLimit?: number}} [options]
 * @returns {{file: string, count: number}[]}
 */
function getCoChangePartners(filePath, coChangeData, options = {}) {
  if (!coChangeData || !coChangeData.pairCounts) return [];
  const config = { ...DEFAULT_CONFIG, ...options };
  const partners = [];
  for (const [key, count] of coChangeData.pairCounts) {
    if (count < config.minCount) continue;
    const [a, b] = key.split('|');
    if (a === filePath || b === filePath) {
      partners.push({ file: a === filePath ? b : a, count });
    }
  }
  partners.sort((a, b) => b.count - a.count || a.file.localeCompare(b.file));
  return partners.slice(0, config.partnerLimit);
}

module.exports = { analyzeCoChanges, getCoChangePartners };
