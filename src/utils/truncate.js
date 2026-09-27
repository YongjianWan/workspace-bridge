/**
 * Output truncation utilities: honest truncation + token reduction.
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

const JSON_ELISION_REASON = 'json-size-limit';
const DEFAULT_JSON_MAX_DEPTH = 12;

/**
 * Recursively walk a plain object/array and elide oversized fields — the
 * formatter-layer safety net behind the producers' own truncateArray caps.
 * Producers only know their own limits, so every cut made here is pushed to
 * `limits.elided` as { path, kind, shown, total, reason }; the caller surfaces
 * that list, otherwise a producer's `truncated: false` would be a lie.
 *
 * Limits applied:
 *   - Arrays longer than `maxArrayLength` → sliced to limit
 *   - Strings longer than `maxStringLength` → elided
 *   - Objects nested deeper than `maxDepth` → null
 *
 * @param {*} value
 * @param {object} [limits]
 * @param {number} [limits.maxArrayLength]
 * @param {number} [limits.maxStringLength]
 * @param {number} [limits.maxDepth]
 * @param {Array} [limits.elided] — receives one record per cut
 * @returns {*}
 */
function elideDeep(value, limits = {}) {
  const maxArrayLength = limits.maxArrayLength ?? DEFAULTS.JSON_OUTPUT_MAX_ARRAY_ITEMS;
  const maxStringLength = limits.maxStringLength ?? DEFAULTS.JSON_OUTPUT_MAX_STRING_LENGTH;
  const maxDepth = limits.maxDepth ?? DEFAULT_JSON_MAX_DEPTH;
  const record = (path, kind, shown, total) => {
    limits.elided?.push({ path, kind, shown, total, reason: JSON_ELISION_REASON });
  };
  const join = (base, key) => (base ? `${base}.${key}` : key);

  function walk(node, depth, path) {
    const isObject = node !== null && typeof node === 'object';
    if (depth > maxDepth) {
      if (!isObject) return node;
      record(path, 'depth', 0, null);
      return null;
    }
    if (Array.isArray(node)) {
      if (node.length > maxArrayLength) record(path, 'array', maxArrayLength, node.length);
      return node.slice(0, maxArrayLength).map((v, i) => walk(v, depth + 1, `${path}[${i}]`));
    }
    if (isObject) {
      const out = {};
      for (const [k, v] of Object.entries(node)) out[k] = walk(v, depth + 1, join(path, k));
      return out;
    }
    if (typeof node === 'string' && node.length > maxStringLength) {
      record(path, 'string', maxStringLength, node.length);
      return elideString(node, maxStringLength);
    }
    return node;
  }

  return walk(value, 0, '');
}

module.exports = {
  truncateArray,
  elideString,
  elideDeep,
};
