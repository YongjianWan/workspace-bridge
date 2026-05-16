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

module.exports = {
  sanitizeShellArg,
  sanitizeSymbolName,
};
