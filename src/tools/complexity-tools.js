const fs = require('fs');
const path = require('path');
const { runGit } = require('../utils/command');
const { registry } = require('../services/dep-graph/parsers/registry');

function getBaseRevision(options = {}) {
  if (options.commits) {
    // If range is commitA..commitB, base is commitA
    const parts = options.commits.split('..');
    if (parts.length > 1) {
      return parts[0].trim();
    }
    const single = options.commits.trim();
    return single ? `${single}~1` : 'HEAD';
  }
  if (options.since) {
    return options.since;
  }
  return 'HEAD';
}

async function getFileComplexityTrend(root, filePath, options = {}) {
  const baseRev = getBaseRevision(options);
  const relativeFile = path.relative(root, filePath).replace(/\\/g, '/');

  // 1. Fetch base version content via git show
  const gitShowResult = await runGit(['show', `${baseRev}:${relativeFile}`], root);
  if (!gitShowResult.ok) {
    // Untracked or new file -> GROWING
    return 'GROWING';
  }
  const baseContent = gitShowResult.stdout;

  // 2. Fetch current version content from disk
  let currentContent = '';
  try {
    currentContent = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return 'STABLE';
  }

  // Remove UTF-8 BOM if present
  const stripBOM = (str) => str.startsWith('\ufeff') ? str.slice(1) : str;
  const cleanBase = stripBOM(baseContent);
  const cleanCurrent = stripBOM(currentContent);

  // 3. Parse both versions
  const ext = path.extname(filePath).toLowerCase();
  const langConfig = registry.findByExt(ext);

  let baseComplexity = 0;
  let currentComplexity = 0;
  let useAST = false;

  if (langConfig) {
    try {
      const baseParsed = langConfig.async ? await langConfig.parse(cleanBase, filePath) : langConfig.parse(cleanBase, filePath);
      const currentParsed = langConfig.async ? await langConfig.parse(cleanCurrent, filePath) : langConfig.parse(cleanCurrent, filePath);

      if (baseParsed && Array.isArray(baseParsed.functionRecords) &&
          currentParsed && Array.isArray(currentParsed.functionRecords)) {
        // Read top-level branchCount first; fallback to legacy fingerprint for older parsers.
        const sumBranches = (records) => records.reduce((sum, f) => {
          const bc = f.branchCount ?? f.fingerprint?.branchCount ?? 0;
          return sum + (typeof bc === 'number' ? bc : 0);
        }, 0);
        baseComplexity = sumBranches(baseParsed.functionRecords);
        currentComplexity = sumBranches(currentParsed.functionRecords);
        // Only trust AST complexity when we actually got non-zero branch data;
        // otherwise fallback to LOC trend to avoid false GROWING/STABLE signals.
        useAST = baseComplexity > 0 || currentComplexity > 0;
      }
    } catch (e) {
      // Parse failed on one of the versions, fallback to line count
    }
  }

  if (!useAST) {
    const getLoc = (content) => (content.match(/\n/g) || []).length + 1;
    baseComplexity = getLoc(cleanBase);
    currentComplexity = getLoc(cleanCurrent);
  }

  if (baseComplexity === 0) {
    return currentComplexity > 0 ? 'GROWING' : 'STABLE';
  }

  const ratio = currentComplexity / baseComplexity;
  if (ratio >= 1.10) {
    return 'GROWING';
  }
  if (ratio <= 0.90) {
    return 'SHRINKING';
  }
  return 'STABLE';
}

module.exports = {
  getFileComplexityTrend
};
