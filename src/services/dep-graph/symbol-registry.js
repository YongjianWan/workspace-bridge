const path = require('path');
const { toPosixPath, normalizePathKey } = require('../../utils/path');
const { SYMBOL_DISAMBIGUATION: DISAMBIG } = require('../../config/scoring');

/**
 * SymbolRegistry — lightweight global symbol table built from AST exportRecords.
 *
 * Wave 1: Pure in-memory construction after build(). No persistence.
 * Provides symbol-level lookup for resolver fallback and cross-validation.
 */
class SymbolRegistry {
  constructor() {
    // symbolName -> Array<{file, kind, lineStart, lineEnd}>
    this.exports = new Map();
    // file -> Set(symbolNames) for incremental cleanup
    this.files = new Map();
  }

  /**
   * Register all exported symbols from a file.
   * @param {string} filePath
   * @param {Array<{name:string,kind?:string,lineStart?:number,lineEnd?:number}>} exportRecords
   */
  register(filePath, exportRecords) {
    if (!exportRecords || exportRecords.length === 0) return;
    this.unregister(filePath);

    const names = new Set();
    for (const record of exportRecords) {
      const name = record.name;
      if (!name) continue;
      names.add(name);

      const locations = this.exports.get(name) || [];
      locations.push({
        file: filePath,
        kind: record.kind || 'unknown',
        lineStart: record.lineStart ?? null,
        lineEnd: record.lineEnd ?? null,
        isExported: record.isExported !== false,
      });
      this.exports.set(name, locations);
    }
    this.files.set(filePath, names);
  }

  /**
   * Remove all symbols registered for a given file.
   * @param {string} filePath
   */
  unregister(filePath) {
    const names = this.files.get(filePath);
    if (!names) return;

    for (const name of names) {
      const locations = this.exports.get(name);
      if (!locations) continue;
      const filtered = locations.filter((loc) => loc.file !== filePath);
      if (filtered.length === 0) {
        this.exports.delete(name);
      } else {
        this.exports.set(name, filtered);
      }
    }
    this.files.delete(filePath);
  }

  /**
   * Look up all files that export a given symbol name.
   * @param {string} symbolName
   * @returns {Array<{file:string,kind:string,lineStart:number|null,lineEnd:number|null}>}
   */
  lookup(symbolName) {
    return this.exports.get(symbolName) || [];
  }

  /**
   * Look up a symbol and return the unique file if exactly one exports it.
   * If multiple files export the same symbol, returns null.
   * @param {string} symbolName
   * @param {string} [preferredDir] — if multiple matches, prefer files in this directory
   * @returns {string|null}
   */
  lookupUnique(symbolName, preferredDir) {
    const locations = this.exports.get(symbolName);
    if (!locations || locations.length === 0) return null;
    if (locations.length === 1) return locations[0].file;

    if (preferredDir) {
      const normalizedPreferredDir = path.isAbsolute(preferredDir)
        ? normalizePathKey(preferredDir)
        : toPosixPath(path.normalize(preferredDir));
      const inPreferred = locations.filter((loc) => loc.file.startsWith(normalizedPreferredDir));
      if (inPreferred.length === 1) return inPreferred[0].file;
    }
    return null;
  }

  /**
   * Look up a symbol using score-based disambiguation (same dir, path depth math).
   * @param {string} symbolName
   * @param {string} [fromFile]
   * @returns {string|null}
   */
  lookupBestMatch(symbolName, fromFile) {
    // A non-exported top-level declaration (recorded by the prescan for lookup
    // purposes) must never resolve an import. Dropping those candidates up
    // front — instead of scoring them and hoping an exported one outranks them —
    // is what makes that invariant hold: with locality bonuses alone, a private
    // sibling beats a private stranger and would win the whole election.
    const locations = (this.exports.get(symbolName) || []).filter((loc) => loc.isExported !== false);
    if (locations.length === 0) return null;
    if (locations.length === 1) return locations[0].file;

    const fromNormalized = fromFile ? normalizePathKey(fromFile) : null;
    const fromDir = fromNormalized ? path.dirname(fromNormalized) : null;
    const fromExt = fromNormalized ? path.extname(fromNormalized) : null;
    const fromParts = fromDir ? fromDir.split('/') : [];

    let bestMatch = null;
    let highestScore = -1;
    let secondHighestScore = -1;

    for (const loc of locations) {
      let score = 0;
      const candidateNormalized = normalizePathKey(loc.file);
      const candidateDir = path.dirname(candidateNormalized);
      const candidateExt = path.extname(candidateNormalized);

      if (fromDir && candidateDir === fromDir) {
        score += DISAMBIG.SCORE_SAME_DIR;
      } else if (fromParts.length > 0) {
        const candidateParts = candidateDir.split('/');
        let commonDepth = 0;
        for (let i = 0; i < Math.min(fromParts.length, candidateParts.length); i++) {
          if (fromParts[i] === candidateParts[i]) commonDepth++;
          else break;
        }
        if (commonDepth >= 2) {
          score += DISAMBIG.SCORE_SAME_MODULE;
        }
      }

      if (fromExt && candidateExt === fromExt) {
        score += DISAMBIG.SCORE_SAME_EXT;
      }

      if (score > highestScore) {
        secondHighestScore = highestScore;
        highestScore = score;
        bestMatch = loc.file;
      } else if (score > secondHighestScore) {
        secondHighestScore = score;
      }
    }

    if (highestScore - secondHighestScore >= DISAMBIG.MIN_GAP_THRESHOLD) {
      return bestMatch;
    }
    return null;
  }

  /**
   * Get all symbol names exported by a file.
   * @param {string} filePath
   * @returns {string[]}
   */
  getExportedSymbols(filePath) {
    const names = this.files.get(filePath);
    if (!names) return [];
    // this.files holds every registered name (needed for unregister cleanup);
    // the public contract is exported symbols only.
    return Array.from(names).filter((name) =>
      (this.exports.get(name) || []).some((loc) => loc.file === filePath && loc.isExported !== false)
    );
  }

  /**
   * Names exported from more than one file, most-collided first.
   *
   * Single source of truth for "duplicate symbol": prescan registers every
   * top-level declaration (isExported: false) so lookups can see them, but a
   * private declaration shares nothing — 227 test files each declaring their
   * own `main` is not a collision. Every consumer must go through here rather
   * than walking `this.exports` raw.
   *
   * @param {{limit?:number}} [options]
   * @returns {Array<{name:string,count:number,files:string[]}>}
   */
  getDuplicateSymbols({ limit } = {}) {
    const duplicates = [];
    for (const [name, locations] of this.exports) {
      const exported = locations.filter((loc) => loc.isExported !== false);
      if (exported.length > 1) {
        duplicates.push({ name, count: exported.length, files: exported.map((loc) => loc.file) });
      }
    }
    duplicates.sort((a, b) => b.count - a.count);
    return typeof limit === 'number' ? duplicates.slice(0, limit) : duplicates;
  }

  /**
   * Get registry statistics.
   * @returns {{symbolCount:number,fileCount:number,duplicateSymbols:number}}
   */
  getRegistryStats() {
    return {
      symbolCount: this.exports.size,
      fileCount: this.files.size,
      duplicateSymbols: this.getDuplicateSymbols().length,
    };
  }

  /**
   * Clear the entire registry.
   */
  clear() {
    this.exports.clear();
    this.files.clear();
  }
}

module.exports = { SymbolRegistry };
