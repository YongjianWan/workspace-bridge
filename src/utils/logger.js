/**
 * Simple logger with DEBUG support
 * Set DEBUG=1 environment variable to enable debug logging
 */

const isDebug = process.env.DEBUG === '1' || process.env.DEBUG === 'true';

/**
 * Log debug message (only shown when DEBUG=1)
 * @param {...any} args - Arguments to log
 */
function debug(...args) {
  if (isDebug) {
    console.error('[DEBUG]', ...args);
  }
}

/**
 * Log info message (always shown)
 * @param {...any} args - Arguments to log
 */
function info(...args) {
  console.error('[INFO]', ...args);
}

/**
 * Log warning message (always shown)
 * @param {...any} args - Arguments to log
 */
function warn(...args) {
  console.error('[WARN]', ...args);
}

/**
 * Log error message (always shown)
 * @param {...any} args - Arguments to log
 */
function error(...args) {
  console.error('[ERROR]', ...args);
}

module.exports = {
  debug,
  info,
  warn,
  error,
  isDebug,
};
