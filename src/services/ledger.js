/**
 * Ledger — the one place a run writes down what it dropped or failed to do.
 *
 * Each entry has a reason code from REASON_CODES, so a consumer reads "why" from the code
 * instead of parsing prose. Output warnings are derived from the entries; nothing keeps a
 * second copy. Unknown codes throw: a typo must not become a silently missing warning.
 */

const REASON_CODES = Object.freeze({
  'file-too-large': { severity: 'high' },
  'unsupported-source-encoding': { severity: 'high' },
  'depth-truncated': { severity: 'medium' },
  'index-timeout': { severity: 'high' },
  'slow-run': { severity: 'low' },
  'analysis-stage-failed': { severity: 'high' },
  'cache-directory-fallback': { severity: 'medium' },
  'cache-load-failed': { severity: 'medium' },
  'cache-write-failed': { severity: 'medium' },
  'gitignore-unavailable': { severity: 'low' },
  'unsupported-source-files': { severity: 'high' },
  'dynamic-load-unresolved': { severity: 'medium' },
  'config-warning': { severity: 'medium' },
  'regex-fallback': { severity: 'medium' },
  'unsupported-extension': { severity: 'low' },
  'parser-error': { severity: 'medium' },
  'empty-graph': { severity: 'high' },
  'unresolved-dropped': { severity: 'low' },
  'unresolved-import-ownership': { severity: 'low' },
  'python-stdlib-fallback': { severity: 'medium' },
  'history-unavailable': { severity: 'medium' },
  'target-not-indexed': { severity: 'high' },
  'unknown-fields': { severity: 'medium' },
  'missing-target': { severity: 'high' },
  'ignored-option': { severity: 'low' },
  'external-tool-unavailable': { severity: 'medium' },
  'container-shutdown-failed': { severity: 'medium' },
  'api-contract-read-error': { severity: 'medium' },
  'api-contract-dynamic-url-skipped': { severity: 'low' },
  'api-contract-path-normalization': { severity: 'low' },
});

/** One warning in the `warnings[]` shape, for producers that sit outside a run's ledger. */
function warningOf(code, fields = {}) {
  const meta = REASON_CODES[code];
  if (!meta) throw new Error(`Unknown ledger reason code: ${code}`);
  return { type: code, severity: meta.severity, ...fields };
}

class Ledger {
  constructor() {
    this._entries = [];
  }

  /** Append an entry. `fields` are copied into the warning as-is (message, files, stage, ...); a `severity` field overrides the code's default. */
  record(code, fields = {}) {
    const meta = REASON_CODES[code];
    if (!meta) throw new Error(`Unknown ledger reason code: ${code}`);
    this._entries.push({ code, severity: meta.severity, ...fields });
  }

  /** Drop every entry of `code`; with `match`, only those whose fields equal it. */
  clear(code, match = {}) {
    this._entries = this._entries.filter((entry) => entry.code !== code
      || Object.entries(match).some(([key, value]) => entry[key] !== value));
  }

  /** Swap all entries of `code` for the current ones (state that is recomputed, not appended). */
  replace(code, entries) {
    this.clear(code);
    for (const fields of entries) this.record(code, fields);
  }

  has(...codes) {
    return this._entries.some((entry) => codes.includes(entry.code));
  }

  /** Entries in the `warnings[]` shape consumers already read: `type` is the reason code. */
  warnings() {
    return this._entries.map(({ code, ...rest }) => ({ type: code, ...rest }));
  }
}

module.exports = { Ledger, REASON_CODES, warningOf };
