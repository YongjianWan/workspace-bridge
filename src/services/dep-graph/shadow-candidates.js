const path = require('path');

const SHADOW_GROUPS = [
  {
    exts: ['.d.ts', '.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs'],
    indexDir: true,
  },
  {
    exts: ['.pyi', '.py'],
  },
  {
    exts: ['.hpp', '.h', '.cpp', '.c', '.cc'],
  },
];

const SHADOW_EXTS = SHADOW_GROUPS.flatMap((g) => g.exts);

/**
 * Calculates possible shadow candidate paths for an added or modified file.
 * Applies to JS/TS, Python (.py ↔ .pyi), and C/C++ (.h/.hpp ↔ .c/.cpp/.cc) extensions.
 *
 * @param {string} addedPath - The absolute or relative file path
 * @returns {string[]} An array of de-duplicated candidate file paths
 */
function shadowCandidatesFor(addedPath) {
  const lowerPath = addedPath.toLowerCase();

  // Find the language group the path belongs to; cross-language shadowing is not allowed.
  const group = SHADOW_GROUPS.find((g) =>
    g.exts.some((e) => lowerPath.endsWith(e.toLowerCase()))
  );
  if (!group) {
    return [];
  }

  // Sort extensions descending by length so that '.d.ts' / '.pyi' / '.hpp' match before shorter variants.
  const sortedExts = group.exts.slice().sort((a, b) => b.length - a.length);
  const ext = sortedExts.find((e) => lowerPath.endsWith(e.toLowerCase())) || '';
  if (!ext) {
    return [];
  }

  const dir = path.dirname(addedPath);
  const baseWithoutExt = path.basename(addedPath, addedPath.slice(addedPath.length - ext.length));
  const candidates = new Set();

  // Scenario 1: Same basename, different extension within the same language group.
  for (const otherExt of group.exts) {
    if (otherExt.toLowerCase() !== ext.toLowerCase()) {
      candidates.add(path.join(dir, baseWithoutExt + otherExt));
    }
  }

  // Scenario 2: Bare file vs directory index (JS/TS only).
  if (group.indexDir) {
    if (baseWithoutExt.toLowerCase() === 'index') {
      // addedPath is like 'foo/index.ts'. It shadows or is shadowed by 'foo.ts', 'foo.js'.
      const parentDir = path.dirname(dir);
      const parentBase = path.basename(dir);
      for (const otherExt of group.exts) {
        candidates.add(path.join(parentDir, parentBase + otherExt));
      }
    } else {
      // addedPath is like 'foo.ts'. It shadows or is shadowed by 'foo/index.ts', 'foo/index.js'.
      for (const otherExt of group.exts) {
        candidates.add(path.join(dir, baseWithoutExt, 'index' + otherExt));
      }
    }
  }

  return Array.from(candidates);
}

module.exports = {
  SHADOW_EXTS,
  shadowCandidatesFor,
};
