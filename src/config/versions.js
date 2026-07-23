/**
 * Schema and cache version constants.
 */
// CLI/API schema version. Increment when JSON output structure changes.
const SCHEMA_VERSION = '1.2.0';

// Cache schema version. Increment when persistent cache structure changes.
// Both WorkspaceCache (JSON fallback) and GraphDB (SQLite) must use the same version.
// v5: L1-3 — tier3 same-package edges no longer count as export usage;
//     persisted deadExports aggregates computed under v4 semantics are stale.
const CACHE_VERSION = 5;

module.exports = { SCHEMA_VERSION, CACHE_VERSION };
