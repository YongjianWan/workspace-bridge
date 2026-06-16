/**
 * EntryDetector — Framework-aware entry file detection and caching.
 *
 * Extracted from dep-graph.js as part of Route A-2 cleanup.
 * Consolidates isKnownEntryFile + getFrameworkHint and eliminates
 * duplicated content-scan logic between the two methods.
 */
const fs = require('fs');
const path = require('path');
const { normalizePathKey } = require('../../utils/path');
const { ENTRY_BASE_NAMES } = require('../../utils/project-context');
const { detectFrameworkFromPath, detectFrameworkFromContentSync } = require('./framework-patterns');
const { LIMITS } = require('../../config/constants');
const {
  FRAMEWORK_MANAGED_PATTERNS,
  KNOWN_CONFIG_NAMES,
  PYTHON_MAIN_PATTERN,
} = require('./shared');

/**
 * Read the first N bytes of a file for content-based detection.
 * Returns null if the file is too large or unreadable.
 * @param {string} filePath
 * @returns {string|null}
 */
function readScanContent(filePath) {
  try {
    const stats = fs.statSync(filePath);
    if (stats.size > LIMITS.ENTRY_FILE_MAX_BYTES) return null;

    const fd = fs.openSync(filePath, 'r');
    try {
      const buffer = Buffer.alloc(LIMITS.ENTRY_SCAN_BYTES);
      const bytesRead = fs.readSync(fd, buffer, 0, LIMITS.ENTRY_SCAN_BYTES, 0);
      return buffer.toString('utf8', 0, bytesRead);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

class EntryDetector {
  constructor({ entryFiles, normalizeFilePath, bus, getFileInfo } = {}) {
    this.entryFiles = entryFiles || new Set();
    this.normalizeFilePath = normalizeFilePath || ((p) => p);
    this.getFileInfo = getFileInfo || null;
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
  isKnownEntryFile(filePath, exports) {
    const key = this.normalizeFilePath(filePath);
    if (this._cache.has(key)) {
      return this._cache.get(key);
    }

    let result = false;
    if (this.entryFiles.has(key)) {
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
            const content = readScanContent(filePath);
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

    const content = readScanContent(filePath);
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
