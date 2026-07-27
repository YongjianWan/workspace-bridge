/**
 * Schema and cache version constants.
 */
// CLI/API schema version. Increment when JSON output structure changes.
const SCHEMA_VERSION = '1.2.0';

// Cache schema version. Increment when persistent cache structure changes.
// Both WorkspaceCache (JSON fallback) and GraphDB (SQLite) must use the same version.
// v5: L1-3 — tier3 same-package edges no longer count as export usage;
//     persisted deadExports aggregates computed under v4 semantics are stale.
// v6: test_map precompute depth unified with query default (3 → CONFIG.DEFAULT_MAX_DEPTH);
//     maps stored under v5 miss import rows at distance 4-5 and carry sentinel 4.
//     analysis_snapshots rows now carry a per-row cache_version stamp; unstamped
//     (pre-v6) snapshots are rejected on load instead of short-circuiting overview.
// v7: Pre-scan Global Symbol Mapping (Pilot). export_records stores top-level declarations with isExported: false.
// v8: review fix — restores the CJS ObjectMethod export branch (v7-era caches
//     miss shorthand-method exports and carry duplicate ObjectProperty records).
const CACHE_VERSION = 8;

module.exports = { SCHEMA_VERSION, CACHE_VERSION };
