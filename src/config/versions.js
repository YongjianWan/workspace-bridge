/**
 * Schema and cache version constants.
 */
// CLI/API schema version. Increment when JSON output structure changes.
const SCHEMA_VERSION = '1.2.0';

// Cache schema version. Increment when persistent cache structure changes.
// Both WorkspaceCache (JSON fallback) and GraphDB (SQLite) must use the same version.
// Bump whenever persisted parse results, edges or aggregates would differ from
// what the current code computes — an old cache is otherwise trusted silently.
const CACHE_VERSION = 52;

module.exports = { SCHEMA_VERSION, CACHE_VERSION };
