/**
 * Schema and cache version constants.
 */
// CLI/API schema version. Increment when JSON output structure changes.
const SCHEMA_VERSION = '1.2.0';

// Cache schema version. Increment when persistent cache structure changes.
// Both WorkspaceCache (JSON fallback) and GraphDB (SQLite) must use the same version.
const CACHE_VERSION = 3;

module.exports = { SCHEMA_VERSION, CACHE_VERSION };
