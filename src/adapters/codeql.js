/**
 * CodeQL adapter — skeleton for future full implementation.
 *
 * CodeQL requires:
 * 1. `codeql database create <db> --language=<lang> --source-root=<cwd>`
 * 2. `codeql database analyze <db> --format=sarifv2.1.0 --output=<out> <packs>`
 *
 * Full implementation is deferred because database creation is expensive
 * and the adapter needs careful caching strategy.
 */
const { BaseAdapter } = require('./base');
const { commandExists } = require('../utils/command');

class CodeQLAdapter extends BaseAdapter {
  get name() {
    return 'codeql';
  }

  async isAvailable(cwd) {
    return commandExists('codeql', cwd);
  }

  async scan(targets, options = {}) {
    void targets;
    return {
      findings: [],
      summary: {
        total: 0,
        scanned: 0,
        error: 'CodeQL adapter requires database creation. Run: codeql database create --language=<lang> --source-root=. <db-name>',
      },
    };
  }

  normalizeFinding(raw) {
    void raw;
    return {
      ruleId: 'unknown',
      message: 'CodeQL normalizeFinding not yet implemented',
      severity: 'medium',
      file: '',
      tool: this.name,
    };
  }
}

module.exports = { CodeQLAdapter };
