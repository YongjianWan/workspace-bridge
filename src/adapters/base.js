/**
 * Base adapter for external security/analysis tools.
 * Subclasses implement scan() for a specific tool (Semgrep, CodeQL, etc.)
 */
class BaseAdapter {
  constructor(options = {}) {
    this.options = options;
  }

  get name() {
    throw new Error('Subclass must implement name');
  }

  /**
   * Check if the external tool is installed and available.
   * @param {string} cwd
   * @returns {Promise<boolean>}
   */
  async isAvailable(cwd) {
    void cwd;
    return false;
  }

  /**
   * Run the tool against the given targets.
   * @param {string[]} targets - File/directory paths to scan
   * @param {object} options - { cwd, config, ... }
   * @returns {Promise<{findings: Array, summary: object}>}
   */
  async scan(targets, options = {}) {
    void targets;
    void options;
    throw new Error('Subclass must implement scan');
  }

  /**
   * Normalize a raw tool finding into workspace-bridge unified format.
   * @param {object} raw
   * @returns {{ruleId: string, message: string, severity: string, file: string, lineStart?: number, lineEnd?: number, tool: string}}
   */
  normalizeFinding(raw) {
    void raw;
    throw new Error('Subclass must implement normalizeFinding');
  }
}

module.exports = { BaseAdapter };
