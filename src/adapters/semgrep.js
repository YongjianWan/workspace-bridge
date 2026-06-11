/**
 * Semgrep adapter — lightweight static analysis via `semgrep --json`
 */
const { BaseAdapter } = require('./base');
const { runCommandSecure, commandExists } = require('../utils/command');

class SemgrepAdapter extends BaseAdapter {
  get name() {
    return 'semgrep';
  }

  async isAvailable(cwd) {
    return commandExists('semgrep', cwd);
  }

  async scan(targets, options = {}) {
    if (!targets || targets.length === 0) {
      return { findings: [], summary: { total: 0, scanned: 0, error: null } };
    }

    const config = options.config || 'auto';
    const args = [
      '--json',
      '--config', config,
      '--quiet',
      ...targets,
    ];

    const result = await runCommandSecure('semgrep', args, options.cwd);

    let parsed;
    try {
      const { stripBOM } = require('../utils/sanitize');
      parsed = JSON.parse(stripBOM(result.stdout));
    } catch {
      // stdout is not valid JSON — treat as hard failure regardless of exit code
      return {
        findings: [],
        summary: {
          total: 0,
          scanned: targets.length,
          error: 'Invalid JSON from semgrep',
        },
      };
    }

    // If stdout parsed successfully but exit code was non-zero (e.g. --error flag),
    // still return the findings rather than discarding them.
    if (!result.ok && (!parsed?.results || !Array.isArray(parsed.results))) {
      return {
        findings: [],
        summary: {
          total: 0,
          scanned: targets.length,
          error: result.stderr || result.stdout || 'Semgrep exited with non-zero code',
        },
      };
    }

    const rawResults = Array.isArray(parsed.results) ? parsed.results : [];
    const findings = rawResults.map((r) => this.normalizeFinding(r));
    return {
      findings,
      summary: {
        total: findings.length,
        scanned: targets.length,
        errors: Array.isArray(parsed.errors) ? parsed.errors.length : 0,
        config,
        error: null,
      },
    };
  }

  normalizeFinding(raw) {
    const severityMap = {
      ERROR: 'high',
      HIGH: 'high',
      WARNING: 'medium',
      MEDIUM: 'medium',
      INFO: 'low',
      LOW: 'low',
    };
    const rawSeverity = raw.extra?.metadata?.severity || raw.extra?.severity;
    const severity = severityMap[String(rawSeverity).toUpperCase()] || 'medium';

    return {
      ruleId: raw.check_id || 'unknown',
      rule: raw.check_id || 'unknown',
      message: raw.extra?.message || raw.extra?.lines || '',
      severity,
      file: raw.path || '',
      lineStart: raw.start?.line,
      lineEnd: raw.end?.line,
      tool: this.name,
    };
  }
}

module.exports = { SemgrepAdapter };
