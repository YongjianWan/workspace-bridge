# workspace-bridge v1.0.2 Release Notes

> CLI-first workspace analysis engine for local AI coding agents.

---

## CodeQL Removed

**CodeQL adapter has been removed.** After real-world evaluation, CodeQL's cost model does not align with workspace-bridge's target user (AI coding agents).

| Dimension | CodeQL | Semgrep (retained) |
|-----------|--------|-------------------|
| Install | 500MB+ CLI download + env setup | `pip install semgrep` (seconds) |
| First run | Database creation 1-5 min + analysis 1-5 min | Direct file scan (seconds) |
| Incremental | Rebuild database required | No database, always incremental |
| Languages | 10+ | 20+ |
| Maintenance | 208 lines + database/cache/SARIF/Windows edge cases | ~60 lines |

**What stays:** `audit-security` continues to work with Semgrep. If you need deeper static analysis, run CodeQL directly — workspace-bridge's thin aggregation layer added no unique value over `codeql database analyze` + reading SARIF yourself.

**Migration:** If you previously used `--db-path` or `--force-refresh`, those flags are removed. `audit-security` now only accepts `--language` (passed to Semgrep) and targets.

---

# workspace-bridge v1.0.1 Release Notes

> CLI-first workspace analysis engine for local AI coding agents.

---

## Security & Reliability Fixes

### CodeQL database no longer written inside user repositories

Previously, `audit-security` with CodeQL created a `.codeql/` directory inside the scanned workspace. This polluted `git status` and risked accidental commits of 5+ MB database files.

**New behavior:**
- Default database path: `~/.workspace-bridge-cache/codeql/<hash>/`
  - `hash` = first 12 chars of SHA-256 of the absolute workspace path
  - Isolated per workspace; no collision across projects
- SARIF results are cleaned up immediately after parsing to avoid cache bloat
- Advanced users can override with `--db-path <dir>`

**Migration:** If you previously committed `.codeql/` to your repo, add it to `.gitignore` and delete the directory.

### Mixed-repo language detection

CodeQL language detection switched from "first match wins" to "detect all." When multiple language markers are found (e.g., Spring Boot + frontend in the same repo):
- **0 candidates:** clear error message asking for `--language`
- **1 candidate:** proceed as before
- **≥2 candidates:** clear error message listing detected languages and requiring `--language`

This fixes the bug where a Java+JavaScript mixed repo was silently scanned as `javascript`.

### Other fixes
- Semgrep + CodeQL now run in parallel (`Promise.all`) instead of serially
- `audit-security` with no targets now defaults to `['.']` instead of silently returning empty results
- `commandExists` now uses the same platform-resolved command name as `spawn`, fixing Windows inconsistencies (`where codeql.exe` vs `spawn codeql.cmd`)
- `dedupeFindings` renamed to `dedupeWithinTool` with JSDoc clarifying that cross-tool duplicates are intentionally preserved (confirmation signal)
- Rust `inferRustModuleName` now excludes `examples/` directories and handles edge cases (`src/mod.rs`, pop-to-empty)

---

# workspace-bridge v1.0.0 Release Notes

> CLI-first workspace analysis engine for local AI coding agents.

---

## Breaking Changes

### `deps` command removed

The `deps` command has been removed from the CLI. It was a thin wrapper around `npm outdated --json` and did not align with workspace-bridge's core mission of cross-file structured analysis.

**Migration guide:**

| Ecosystem | Replacement command |
|-----------|---------------------|
| Node.js   | `npm outdated` or `npm outdated --json` |
| Python    | `pip list --outdated` or `pip-review` |
| Rust      | `cargo outdated` (requires `cargo install cargo-outdated`) |
| Java      | Use your build tool's dependency report (`./gradlew dependencies`, `mvn versions:display-dependency-updates`) |

---

## Delivered Core Capabilities (P0–P5)

### P0 — Foundation
- Cross-file dependency graph construction (JS/TS, Python, Java, Kotlin, Go, Rust)
- `dead-exports` detection with symbol-level confidence
- `unresolved` import detection
- `affected-tests` BFS impact tracing
- Circular dependency detection

### P1 — Analysis Credibility
- Java AST-level parsing (`javalang`) with regex fallback
- Go & Rust package-level parsing
- Symbol-level usage scanning in importers (eliminates Java/Go/Rust dead-export false positives)
- Method-level dead-export filtering for Java

### P1.5 — Global Project Map
- `audit-map` command: tree structure + import/export edges + issue overlay (dead exports / unresolved / cycles / orphans)

### P2 — Command Executability
- Rust workspace member detection (`cargo test -p <crate>`)
- Mixed-repo command precision (`classifyChangeType` + `codeTargets` filtering)
- Standalone `stats`, `dependencies`, `dependents` commands
- REPL interactive query mode (`impact`, `affected-tests`, `dead-exports`, etc.)
- `watch` mode: file-save → instant impact printout
- Parse-result caching (96× speed-up on warm rebuilds)
- Incremental dep-graph updates via Watcher

### P3 — Output Explainability
- Impact path explanations (`via`, `importedSymbols`, `reason`)
- `impactExplanations` causal chains in `audit-diff`
- CJS symbol parsing (`module.exports`, `exports.fn`)
- Internal function change → test mapping (JS/TS)
- Language support matrix in `audit-overview`

### P4 — Engineering Quality
- Parser subsystem split into per-language modules (all < 500 lines)
- Formatter subsystem split into 7 responsibility files
- 5 hard-coded `if-else` chains refactored into configuration tables
- CLI error handling hardened (`--quiet` no longer swallows fatal errors)
- All magic numbers centralized in `src/config/constants.js`

### P5 — Large-Project Experience
- REPL with dep-graph hot cache (< 100 ms per query)
- File-system watcher with incremental graph updates (< 500 ms per change)
- SQLite-based parse-result cache (cold → warm rebuild: 289 ms → 3 ms)

---

## Decision Reversal

**CLI slimming (23 → 8 commands) was cancelled.**

After product review, we concluded that AI agents — the primary user — benefit from atomic commands (precise output, lower token cost) and do not suffer from "choice paralysis." The full command set is retained; only `deps` was removed as out-of-scope.

---

## Compatibility

- **Node.js:** ≥ 16.0.0
- **Python:** 3.x (optional, for Java AST parser and Python AST parser)
- **OS:** Windows, macOS, Linux

---

## Full Changelog

See [CHANGELOG.md](./CHANGELOG.md).
