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
// v9: symbol-table resolution no longer guesses at specifiers npm owns. v8-era
//     caches persist those fabricated edges (209 of this repo's own 1219, all
//     from `require('path')` hitting a re-exported `path` binding) and would
//     serve them as fresh.
// v10: 外部依赖闸扩到 Rust（std/core/alloc 前缀 + Cargo.toml 声明的 crate）。
//      v9 缓存里存着 reference/qartez-mcp 那 48 条 std::/rmcp::/tokio:: 假边。
// v11: 外部依赖闸扩到 Python（标准库根段 + requirements.txt/pyproject.toml
//      声明的包，PEP 503 归一 + 常见包名/导入名别名）。v10 缓存里 Python 仓
//      的 symbol-table 边可能混着 import requests → 本地同名模块的假边。
// v12: 外部依赖闸扩到 Go。Go import 永远带完整路径，归属是确定的：module
//      路径之外的一切（dotted 首段 = 外部模块，无点首段 = 标准库）不再猜。
const CACHE_VERSION = 12;

module.exports = { SCHEMA_VERSION, CACHE_VERSION };
