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
      const baseParsed = langConfig.async ? await langConfig.parser(cleanBase, filePath) : langConfig.parser(cleanBase, filePath);
      const currentParsed = langConfig.async ? await langConfig.parser(cleanCurrent, filePath) : langConfig.parser(cleanCurrent, filePath);

      if (baseParsed && Array.isArray(baseParsed.functionRecords) &&
          currentParsed && Array.isArray(currentParsed.functionRecords)) {
        useAST = true;
        baseComplexity = baseParsed.functionRecords.reduce((sum, f) => sum + (f.fingerprint?.branchCount || 0), 0);
        currentComplexity = currentParsed.functionRecords.reduce((sum, f) => sum + (f.fingerprint?.branchCount || 0), 0);
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
