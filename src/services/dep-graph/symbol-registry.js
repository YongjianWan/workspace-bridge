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
      const inPreferred = locations.filter((loc) => loc.file.startsWith(preferredDir));
      if (inPreferred.length === 1) return inPreferred[0].file;
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
    return names ? Array.from(names) : [];
  }

  /**
   * Get registry statistics.
   * @returns {{symbolCount:number,fileCount:number,duplicateSymbols:number}}
   */
  getRegistryStats() {
    let duplicateSymbols = 0;
    for (const locations of this.exports.values()) {
      if (locations.length > 1) duplicateSymbols++;
    }
    return {
      symbolCount: this.exports.size,
      fileCount: this.files.size,
      duplicateSymbols,
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
