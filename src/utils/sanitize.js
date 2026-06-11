/**
 * Sanitization utilities to prevent shell injection
 */

/**
 * Sanitize a shell argument - only allow safe characters
 */
function sanitizeShellArg(arg) {
  if (typeof arg !== 'string') return '';
  
  // Remove dangerous characters: ; | & $ ` \n \r / \
  // Allow: Unicode letters, digits, _ - .
  return arg.replace(/[^\p{L}\p{N}_\-\.]/gu, '');
}

/**
 * Sanitize a symbol name (for grep/lookup)
 */
function sanitizeSymbolName(name) {
  if (typeof name !== 'string') return '';
  
  // Only allow valid identifier characters
  // Python/JS identifiers: letters, digits, underscore
  // Cannot start with digit
  const sanitized = name.replace(/[^a-zA-Z0-9_]/g, '');
  
  if (!sanitized || /^[0-9]/.test(sanitized)) {
    return ''; // Invalid identifier
  }
  
  return sanitized;
}

/**
 * Sanitize a string for inclusion in AI-facing output.
 * - Truncate to maxLength (appending '⋯')
 * - Strip control characters (C0/C1 and zero-width/format chars)
 */
function sanitizeForAiOutput(text, maxLength = 256) {
  if (typeof text !== 'string') return '';
  let s = text.length > maxLength ? text.slice(0, maxLength) + '⋯' : text;
  // C0 (U+0000–U+001F), DEL (U+007F), zero-width spaces / directional marks / BOM
  s = s.replace(/[\x00-\x1F\x7F\u200B-\u200F\uFEFF]/g, '');
  return s;
}

function stripBOM(str) {
  if (typeof str !== 'string') return str;
  return str.charCodeAt(0) === 0xFEFF ? str.slice(1) : str;
}

module.exports = {
  sanitizeShellArg,
  sanitizeSymbolName,
  sanitizeForAiOutput,
  stripBOM,
};

