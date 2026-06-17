/**
 * Output truncation utilities for Wave 12 (Honest Truncation + Token Reduction).
 *
 * Design principle: truncation happens at the data-producer layer so that
 * `truncated` metadata travels with the result object. A shallow `elideDeep`
 * guard sits at the JSON-formatter layer as a last-resort safety net.
 */

const { DEFAULTS } = require('../config/constants');

/**
 * Truncate an array to a hard limit, returning metadata that lets consumers
 * know whether (and by how much) the result was capped.
 *
 * @param {Array} arr
 * @param {number} limit
 * @returns {{ items: Array, truncated: boolean, total: number }}
 */
function truncateArray(arr, limit) {
  if (!Array.isArray(arr)) {
    return { items: arr ?? [], truncated: false, total: 0 };
  }
  const total = arr.length;
  if (total <= limit) {
    return { items: arr, truncated: false, total };
  }
  return { items: arr.slice(0, limit), truncated: true, total };
}

/**
 * Elide a long string to `maxLen`, appending an ellipsis.
 *
 * @param {string} str
 * @param {number} [maxLen]
 * @param {string} [ellipsis]
 * @returns {string}
 */
function elideString(str, maxLen = DEFAULTS.JSON_OUTPUT_MAX_STRING_LENGTH, ellipsis = '…') {
  if (typeof str !== 'string') return str;
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + ellipsis;
}

/**
 * Recursively walk a plain object/array and elide oversized fields.
 * This is a **formatter-layer safety net**, not the primary truncation
 * mechanism. It does NOT add `truncated` metadata — that is the
 * responsibility of the data-producer layer (truncateArray).
 *
 * Limits applied:
 *   - Arrays longer than `maxArrayLength` → sliced to limit
 *   - Strings longer than `maxStringLength` → elided
 *   - Objects are traversed recursively (depth capped at 8)
 *
 * @param {*} value
 * @param {object} [limits]
 * @param {number} [limits.maxArrayLength]
 * @param {number} [limits.maxStringLength]
 * @param {number} [limits.maxDepth]
 * @param {number} [depth]
 * @returns {*}
 */
function elideDeep(value, limits = {}, depth = 0) {
  const maxArrayLength = limits.maxArrayLength ?? DEFAULTS.JSON_OUTPUT_MAX_ARRAY_ITEMS;
  const maxStringLength = limits.maxStringLength ?? DEFAULTS.JSON_OUTPUT_MAX_STRING_LENGTH;
  const maxDepth = limits.maxDepth ?? 12;

  if (depth > maxDepth) {
    return typeof value === 'object' && value !== null ? null : value;
  }

  if (Array.isArray(value)) {
    const out = value.slice(0, maxArrayLength).map((v) => elideDeep(v, limits, depth + 1));
    return out;
  }

  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = elideDeep(v, limits, depth + 1);
    }
    return out;
  }

  if (typeof value === 'string') {
    return elideString(value, maxStringLength);
  }

  return value;
}

module.exports = {
  truncateArray,
  elideString,
  elideDeep,
};
