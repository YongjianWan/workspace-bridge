/**
 * Exclude pattern matching shared between FileIndex and DependencyGraph.
 * Eliminates copy-paste of shouldExcludeCli logic.
 */
const path = require('path');
const { normalizePathKey, matchesPathFragment } = require('./path');

const DEFAULT_EXCLUDE_DIRS = ['node_modules', '__pycache__', '.venv', 'venv', '.git', 'dist', 'build', 'target', 'bin', 'obj', '.next', '.nuxt', '.svelte-kit', 'out', '.turbo', 'coverage', '.cache', '.idea', '.vscode', 'vendor', 'generated'];

/**
 * Base exclusion check used by both FileIndex and DependencyGraph.
 * Covers cache artefacts and workspace-configured/base exclude directories.
 * CLI --exclude is handled separately by shouldExcludeCli so that
 * CLI-excluded files remain in the graph as importers.
 */
function shouldExcludeBase(filePath, baseExcludeDirs) {
  const base = path.basename(filePath);
  if (base === 'cache.db' || base === 'cache.db-wal' || base === 'cache.db-shm') return true;

  const normalized = normalizePathKey(filePath);
  if (baseExcludeDirs && baseExcludeDirs.some((dir) => matchesPathFragment(normalized, dir))) {
    return true;
  }
  return false;
}

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
        .replace(/\*\*\//g, '###GLOB_STAR_SLASH###')
        .replace(/\*\*/g, '###GLOB_DOUBLE_STAR###')
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]')
        .replace(/###GLOB_STAR_SLASH###/g, '(?:.*/)?')
        .replace(/###GLOB_DOUBLE_STAR###/g, '.*');

      const regex = new RegExp('^' + escaped + '$');
      // basename shortcut only makes sense for filename-only globs (e.g. *.test.js).
      // Path-anchored patterns like src/**/test.js will never match basename,
      // so skip the wasted test and go straight to suffix matching.
      const isFilenameOnlyGlob = !cleanPattern.includes('/');
      if (isFilenameOnlyGlob && regex.test(path.basename(normalized))) return true;
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
  DEFAULT_EXCLUDE_DIRS,
  shouldExcludeBase,
  shouldExcludeCli,
};
