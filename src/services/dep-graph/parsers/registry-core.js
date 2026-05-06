/**
 * Language registry core — inspired by GitNexus language registration pattern.
 *
 * Design goal: adding a new language requires changing exactly one file
 * (registry.js) instead of three (dep-graph.js, parsers/index.js, file-index.js).
 * See registry.js for concrete registration examples.
 */

/**
 * @param {object} config
 * @param {string} config.name
 * @param {string[]} config.exts
 * @param {Function} config.parser
 * @param {boolean} [config.async=false]
 * @param {boolean} [config.needsFilePath=false]
 * @param {string[]} [config.filePatterns]
 * @param {Function} [config.condition]
 * @returns {object}
 */
function defineLanguage(config) {
  return {
    name: config.name,
    exts: config.exts,
    parser: config.parser,
    async: config.async ?? false,
    needsFilePath: config.needsFilePath ?? false,
    filePatterns: config.filePatterns ?? config.exts.map((e) => `**/*${e}`),
    condition: config.condition ?? (() => true),
  };
}

class LanguageRegistry {
  constructor() {
    /** @type {object[]} */
    this.languages = [];
    /** @type {Map<string, object>} ext -> language */
    this._extMap = new Map();
  }

  register(lang) {
    this.languages.push(lang);
    for (const ext of lang.exts) {
      this._extMap.set(ext, lang);
    }
  }

  /**
   * @param {string} ext
   * @returns {object | undefined}
   */
  findByExt(ext) {
    return this._extMap.get(ext);
  }

  /** @returns {string[]} */
  getAllExts() {
    return Array.from(this._extMap.keys());
  }

  /**
   * Generate file-index glob patterns for the given workspace.
   * Falls back to all registered patterns when no conditions match.
   * @param {object} workspace
   * @returns {string[]}
   */
  getFilePatterns(workspace) {
    const patterns = [];
    for (const lang of this.languages) {
      if (!lang.condition || lang.condition(workspace)) {
        for (const pat of lang.filePatterns) {
          patterns.push(pat);
        }
      }
    }
    return patterns.length > 0 ? patterns : this.languages.flatMap((l) => l.filePatterns);
  }
}

module.exports = { defineLanguage, LanguageRegistry };
