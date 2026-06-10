/**
 * Language registry core — inspired by GitNexus language registration pattern.
 *
 * Design goal: adding a new language requires changing exactly one file
 * (registry.js) instead of three (dep-graph.js, parsers/index.js, file-index.js).
 * See registry.js for concrete registration examples.
 */

/**
 * @param {object} config
 * @param {string} [config.language]
 * @param {string} [config.name]
 * @param {string[]} [config.extensions]
 * @param {string[]} [config.exts]
 * @param {Function} [config.parse]
 * @param {Function} [config.parser]
 * @param {Function} [config.extractImports]
 * @param {Function} [config.extractExports]
 * @param {Function} [config.extractSymbols]
 * @param {Function} [config.isBuiltIn]
 * @param {Function[]} [config.resolveStrategies]
 * @param {boolean} [config.async=false]
 * @param {boolean} [config.needsFilePath=false]
 * @param {string[]} [config.filePatterns]
 * @param {Function} [config.condition]
 * @returns {object}
 */
function defineLanguage(config) {
  const language = config.language ?? config.name;
  const extensions = config.extensions ?? config.exts;
  const parse = config.parse ?? config.parser;

  const langObj = {
    language,
    extensions,
    parse,
    extractImports: config.extractImports,
    extractExports: config.extractExports,
    extractSymbols: config.extractSymbols,
    isBuiltIn: config.isBuiltIn ?? (() => false),
    resolveStrategies: config.resolveStrategies ?? [],
    async: config.async ?? false,
    needsFilePath: config.needsFilePath ?? false,
    filePatterns: config.filePatterns ?? extensions.map((e) => `**/*${e}`),
    condition: config.condition ?? (() => true),
  };

  // Compatibility getters/setters for L1 back-compat
  Object.defineProperty(langObj, 'name', {
    get: () => langObj.language,
    set: (val) => { langObj.language = val; },
    configurable: true,
    enumerable: true,
  });
  Object.defineProperty(langObj, 'exts', {
    get: () => langObj.extensions,
    set: (val) => { langObj.extensions = val; },
    configurable: true,
    enumerable: true,
  });
  Object.defineProperty(langObj, 'parser', {
    get: () => langObj.parse,
    set: (val) => { langObj.parse = val; },
    configurable: true,
    enumerable: true,
  });

  return langObj;
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
    const exts = lang.extensions ?? lang.exts;
    for (const ext of exts) {
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
