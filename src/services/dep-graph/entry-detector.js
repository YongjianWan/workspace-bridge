/**
 * EntryDetector — Framework-aware entry file detection and caching.
 *
 * Consolidates isKnownEntryFile + getFrameworkHint and eliminates
 * duplicated content-scan logic between the two methods.
 */
const path = require('path');
const { normalizePathKey } = require('../../utils/path');
const { ENTRY_BASE_NAMES } = require('../../utils/project-context');
const { detectFrameworkFromPath, detectFrameworkFromContentSync } = require('./framework-patterns');
const { LIMITS } = require('../../config/constants');
const { readTextWithin } = require('../../utils/file-read');
const {
  FRAMEWORK_MANAGED_PATTERNS,
  KNOWN_CONFIG_NAMES,
  PYTHON_MAIN_PATTERN,
} = require('./shared');

const C_CPP_ENTRY_EXTENSIONS = new Set(['.c', '.cc', '.cpp', '.cxx']);

/**
 * Read a file for content-based entry detection.
 * Returns null if the file is unreadable or larger than the parser cap.
 * @param {string} filePath
 * @param {(filePath: string, maxBytes: number) => string|null} readSource
 * @returns {string|null}
 */
function readScanContent(filePath, readSource = readTextWithin) {
  try {
    // Scan boundary = parser coverage: files above PARSER_MAX_FILE_BYTES
    // parse with zero exports, so dead-exports never consults them; orphan
    // checks keep the same "too big to judge" behavior as before. Within the
    // cap the FULL file is read — entry signals (a trailing
    // `if __name__ == "__main__":` guard, framework decorators) can sit
    // anywhere, so a fixed head-window produces false positives.
    return readSource(filePath, LIMITS.PARSER_MAX_FILE_BYTES);
  } catch {
    return null;
  }
}

class EntryDetector {
  constructor({ entryFiles, normalizeFilePath, bus, getFileInfo, readSource } = {}) {
    this.entryFiles = entryFiles || new Set();
    this.normalizeFilePath = normalizeFilePath || ((p) => p);
    this.getFileInfo = getFileInfo || null;
    this.readSource = readSource || readTextWithin;
    this._cache = new Map();

    if (bus) {
      bus.on('graph:updated', () => this._cache.clear());
    }
  }

  /**
   * Check whether a file is a known entry point (framework-managed, config, or executable).
   * @param {string} filePath
   * @param {Array} [exports]
   * @returns {boolean}
   */
  isKnownEntryFile(filePath, exports = null) {
    const key = this.normalizeFilePath(filePath);
    if (this._cache.has(key)) {
      return this._cache.get(key);
    }

    let result = false;
    if (this.entryFiles.has(key)) {
      result = true;
    } else if (C_CPP_ENTRY_EXTENSIONS.has(path.extname(filePath).toLowerCase())
      && (exports || this.getFileInfo?.(filePath)?.exports || []).includes('main')) {
      result = true;
    } else {
      const normalized = normalizePathKey(filePath);
      const base = path.basename(normalized);
      if (FRAMEWORK_MANAGED_PATTERNS.some((pattern) => pattern.test(normalized))) {
        result = true;
      } else if (KNOWN_CONFIG_NAMES.has(base)) {
        result = true;
      } else if (ENTRY_BASE_NAMES.has(base)) {
        result = true;
      } else {
        const cachedHint = this.getFileInfo ? this.getFileInfo(filePath)?.frameworkHint : null;
        if (cachedHint) {
          if (cachedHint.isEntry) {
            result = true;
          }
        } else {
          const pathHint = detectFrameworkFromPath(filePath);
          if (pathHint && pathHint.isEntry) {
            result = true;
          } else {
            const content = readScanContent(filePath, this.readSource);
            if (content) {
              const contentHint = detectFrameworkFromContentSync(filePath, content);
              if (contentHint && contentHint.isEntry) {
                result = true;
              } else if (content.startsWith('#!')) {
                result = true;
              } else if (PYTHON_MAIN_PATTERN.test(content)) {
                result = true;
              }
            }
          }
        }
      }
    }

    this._cache.set(key, result);
    return result;
  }

  /**
   * Get framework hint for a file (path-based detection + lightweight content fallback).
   * @param {string} filePath
   * @returns {{ framework: string, reason: string, isEntry: boolean } | null}
   */
  getFrameworkHint(filePath) {
    const cachedHint = this.getFileInfo ? this.getFileInfo(filePath)?.frameworkHint : null;
    if (cachedHint) return cachedHint;

    const pathHint = detectFrameworkFromPath(filePath);
    if (pathHint) return pathHint;

    const content = readScanContent(filePath, this.readSource);
    if (content) {
      return detectFrameworkFromContentSync(filePath, content);
    }
    return null;
  }

  /**
   * Register a bus listener that clears the entry-file cache on graph updates.
   * Called automatically by the constructor when a bus is provided; exposed
   * for manual registration in test / mock scenarios.
   * @param {EventBus} bus
   */
  registerCacheInvalidation(bus) {
    bus.on('graph:updated', () => this._cache.clear());
  }
}

module.exports = { EntryDetector, readScanContent };
