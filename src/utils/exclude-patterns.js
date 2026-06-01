/**
 * Exclude pattern matching shared between FileIndex and DependencyGraph.
 * Eliminates copy-paste of shouldExcludeCli logic.
 */
const path = require('path');
const { normalizePathKey, matchesPathFragment } = require('./path');

/**
 * Check whether a file was excluded by the CLI --exclude flag.
 * These files are kept in the dependency graph (so their imports still
 * protect production code from dead-export false positives) but filtered
 * out of report output.
 *
 * @param {string} filePath — absolute or relative file path
 * @param {string[]} cliExcludeDirs — patterns from CLI --exclude
 * @returns {boolean}
 */
function shouldExcludeCli(filePath, cliExcludeDirs) {
  if (!cliExcludeDirs || cliExcludeDirs.length === 0) return false;
  const normalized = normalizePathKey(filePath);
  return cliExcludeDirs.some((pattern) => {
    // Simple glob support: *.ext, prefix*, ?ingle-char, src/**, src/**/suffix
    if (pattern.includes('*') || pattern.includes('?')) {
      const cleanPattern = pattern.trim();
      const escaped = cleanPattern
        .replace(/\*\*/g, '###GLOB_DOUBLE_STAR###')
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]')
        .replace(/###GLOB_DOUBLE_STAR###/g, '.*');

      const regex = new RegExp('^' + escaped + '$');
      if (regex.test(path.basename(normalized))) return true;
      // Allow path-fragment glob matches by testing every suffix of the path
      const parts = normalized.split('/');
      for (let i = 0; i < parts.length; i++) {
        if (regex.test(parts.slice(i).join('/'))) return true;
      }
      return false;
    }
    return matchesPathFragment(normalized, pattern);
  });
}

module.exports = {
  shouldExcludeCli,
};
