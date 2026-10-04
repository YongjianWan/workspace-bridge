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
  'analysis-stage-failed': { severity: 'high' },
});

class Ledger {
  constructor() {
    this._entries = [];
  }

  /** Append an entry. `fields` are copied into the warning as-is (message, files, stage, ...). */
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

module.exports = { Ledger, REASON_CODES };
