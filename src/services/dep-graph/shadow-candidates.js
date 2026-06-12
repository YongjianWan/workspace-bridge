const path = require('path');

const SHADOW_EXTS = ['.d.ts', '.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs'];

/**
 * Calculates possible shadow candidate paths for an added or modified file.
 * Only applies to JS/TS extensions.
 * 
 * @param {string} addedPath - The absolute or relative file path
 * @returns {string[]} An array of de-duplicated candidate file paths
 */
function shadowCandidatesFor(addedPath) {
  // Sort SHADOW_EXTS descending by length so that '.d.ts' matches before '.ts'
  const sortedExts = SHADOW_EXTS.slice().sort((a, b) => b.length - a.length);
  const ext = sortedExts.find(e => addedPath.toLowerCase().endsWith(e.toLowerCase())) || '';
  if (!ext) {
    return [];
  }

  const dir = path.dirname(addedPath);
  const baseWithoutExt = path.basename(addedPath, addedPath.slice(addedPath.length - ext.length));
  const candidates = new Set();

  // Scenario 1: Same basename, different extension (e.g. foo.ts and foo.js)
  for (const otherExt of SHADOW_EXTS) {
    if (otherExt.toLowerCase() !== ext.toLowerCase()) {
      candidates.add(path.join(dir, baseWithoutExt + otherExt));
    }
  }

  // Scenario 2: Bare file vs directory index
  if (baseWithoutExt.toLowerCase() === 'index') {
    // addedPath is like 'foo/index.ts'. It shadows or is shadowed by 'foo.ts', 'foo.js'
    const parentDir = path.dirname(dir);
    const parentBase = path.basename(dir);
    for (const otherExt of SHADOW_EXTS) {
      candidates.add(path.join(parentDir, parentBase + otherExt));
    }
  } else {
    // addedPath is like 'foo.ts'. It shadows or is shadowed by 'foo/index.ts', 'foo/index.js'
    for (const otherExt of SHADOW_EXTS) {
      candidates.add(path.join(dir, baseWithoutExt, 'index' + otherExt));
    }
  }

  return Array.from(candidates);
}

module.exports = {
  SHADOW_EXTS,
  shadowCandidatesFor,
};
