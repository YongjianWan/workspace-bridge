# SKILL-REFERENCE.md

> workspace-bridge-cli 完整命令参考手册。供人工查阅和深度使用。
> AI 快速上手请优先阅读 [SKILL.md](./SKILL.md)。

---

## CLI resolution order (for random paths/new windows)

Use this fallback chain:

1. `npx workspace-bridge-cli ...` (most reliable — no global install needed)
2. `workspace-bridge-cli ...` (global command, if installed)
3. `node <workspace-bridge-repo>/cli.js ...` (repo-local fallback)

## Output format options

```bash
workspace-bridge-cli audit-summary --cwd <project>           # human-readable
workspace-bridge-cli audit-summary --cwd <project> --json --quiet  # structured JSON
workspace-bridge-cli audit-summary --cwd <project> --format markdown --quiet  # AI-friendly
workspace-bridge-cli audit-summary --cwd <project> --format jsonl --quiet     # pipe-friendly
```

- `--json`: machine-readable output with `schemaVersion`
- `--quiet`: suppress stderr logs (use with `--json`)
- `--compact`: for 500+ file repos, ~97% volume reduction
- `--format summary`: concise human-readable summary (~8–20 lines)
- `--format markdown`: Markdown-formatted output with headings, lists, and code blocks
- `--format jsonl`: JSON Lines — one JSON object per line. Pipe-friendly and streamable
- `--since <commit>`: for `audit-diff`, analyze changes between `<commit>` and HEAD
- `--staged`: for `audit-diff`, analyze only git staged changes
- `--files <list>`: comma-separated file list for `audit-diff` or `audit-security`
- `--save <file>`: for `audit-summary`, save findings snapshot to JSON baseline file
- `--check-regression`: for `audit-summary`, compare current findings against previous baseline
- `--baseline <file|commit>`: custom baseline file path or git commit for `--check-regression`
- `--incremental`: for `audit-diff`, only show findings related to changed files
- `--with-impact`: for `audit-diff`, append `impactFiles` (depth=2 dependents)
- `--severity <high|medium|low>`: filter findings by severity before output
- `--builtin-only`: for `audit-security`, skip external scanners, run 19 built-in rules only
- `--exclude <dirs>`: comma-separated directories to exclude from analysis

## Complete Command List

### Aggregate Commands

```bash
workspace-bridge-cli audit-summary --cwd <project> --json --quiet
workspace-bridge-cli audit-file --cwd <project> --file <file> --json --quiet
workspace-bridge-cli audit-diff --cwd <project> --json --quiet
workspace-bridge-cli audit-diff --cwd <project> --since HEAD~3 --json --quiet
workspace-bridge-cli audit-overview --cwd <project> --json --quiet
workspace-bridge-cli audit-map --cwd <project> --json --quiet
```

### Large Project Mode

For repositories with 500+ files, use `--compact` with `audit-map`:

```bash
workspace-bridge-cli audit-map --cwd <project> --compact --json --quiet
```

Compact mode returns:
- **Directory skeleton** instead of per-file tree (`fileCount` + `totalFileCount` per directory)
- **Module-level edges** instead of file-level imports
- **highlightedFiles** array surfacing entry points and files with issues

Use full mode (`--json --quiet` without `--compact`) when you need complete file-level detail.

### Quick Queries (Single-purpose)

```bash
workspace-bridge-cli stats --cwd <project> --json --quiet
workspace-bridge-cli dependencies --cwd <project> --file <file> --json --quiet
workspace-bridge-cli dependents --cwd <project> --file <file> --json --quiet
```

With exclusions for mixed repos:
```bash
workspace-bridge-cli audit-summary --cwd <project> --exclude prototypes,reference --json --quiet
```

### Raw Commands (Detailed inspection)

```bash
workspace-bridge-cli workspace-info --cwd <project> --json --quiet
workspace-bridge-cli health --cwd <project> --json
workspace-bridge-cli diagnostics --cwd <project> --json
workspace-bridge-cli dead-exports --cwd <project> --json
workspace-bridge-cli unresolved --cwd <project> --json
workspace-bridge-cli cycles --cwd <project> --json
workspace-bridge-cli impact --cwd <project> --file <file> --json
workspace-bridge-cli affected-tests --cwd <project> --file <file> --max-depth 5 --json
workspace-bridge-cli audit-security --cwd <project> --json
workspace-bridge-cli audit-security --cwd <project> --builtin-only --json
workspace-bridge-cli repl --cwd <project>
workspace-bridge-cli watch --cwd <project> --json --quiet
workspace-bridge-cli init
```

## Command Selection Reference

| Scenario | Recommended Command | Why |
|----------|---------------------|-----|
| First time seeing repo | `audit-summary` | Overall health + structural issues |
| Changing specific file | `audit-file --file ...` | Impact + affected tests |
| Git worktree has changes | `audit-diff` | Validation plan + concrete commands |
| Planning refactoring | `audit-overview` | Hotspots + stability + orphans |
| Understanding project structure | `audit-map` | Directory tree + dependency edges + issue overlay. Use `--compact` for large repos |
| Pre-change impact check | `impact --file ...` + `affected-tests --file ...` | Know blast radius before editing |
| Periodic dead code cleanup | `dead-exports` | Monthly cleanup of 0-reference symbols (verify before deleting) |
| New session quick recon | `audit-overview` | Project scale + hotspots + cycles + unresolved in ~10s |
| "Who depends on this file?" | `dependents --file ...` | Direct dependents list |
| "What does this file import?" | `dependencies --file ...` | Direct dependencies list |
| Deep dive on dead code | `dead-exports` | Symbol-level candidates |
| Quick project metadata | `workspace-info` | File counts, languages, entry points |
| Type/lint check current state | `diagnostics` | eslint/tsc/pyright/ruff output |
| Health check | `health` | Overall hygiene score + missing items |
| Security scan | `audit-security` | 19 built-in rules + optional Semgrep adapter. Use `--builtin-only` to skip external scanners |
| Graph scale check | `stats` | Total imports/exports/cycles + coverage ratio |
| Broken imports deep dive | `unresolved` | Per-file broken reference detail |
| Cycle deep dive | `cycles` | Per-cycle file list + length |
| Interactive query mode | `repl` | Fast impact/tests queries without rebuild |
| Watch mode (continuous) | `watch` | Auto-print impact on file save |
| Initialize config | `init` | Generate `.workspace-bridge.json` in cwd |

## Reading Results

All JSON outputs share core fields `{ok, error, severity, summary}` plus `schemaVersion`.

| Command | Read First | Key Detail Fields |
|---------|-----------|-------------------|
| `audit-summary` | `summary.severity` → `summary.nextSteps` | `scope.counts` (mixed repo), `analysisCoverage.coverageRatio` |
| `audit-diff` | `summary.fileTypeBreakdown` → `summary.changeMetrics` | `validationAdvice.changeType/stack/commands/phases` |
| `audit-file` | `severity` → `impact` → `affectedTests` | `validationAdvice`, `frameworkPattern` |
| `audit-overview` | `summary.severity` → `hotspots` | `stability` (check `stabilityMeta`), `orphans`, `architectureAdvice` |
| `dead-exports` / `unresolved` / `cycles` | `<cmd>Count` | `<cmd>[]` per-item (file, severity, confidence, confidenceReason), `possibleFalsePositives` |
| `impact` / `dependents` / `dependencies` | `<cmd>Count` | `<cmd>[]` (file, level, via, importedSymbols), `impact`: check `symbolImpact` |
| `audit-map` | `summary.severity` → `summary.issueCounts` | `tree` / `highlightedFiles`, `edges` |
| `audit-security` | `summary.total` | `findings[]` (severity, rule, file, line) |
| `health` | `healthScore` | `checks`, `fixes`, `testCoverage` |
| `workspace-info` | `fileCount`, `languages`, `entryFiles` | Lightweight preflight before heavier commands |
| `stats` | `files`, `totalImports`, `cycles` | `analysisCoverage.coverageRatio` |
| `diagnostics` | `diagnosticsSummary.total` | `results[].diagnostics`; `noLintersDetected: true` means no linters found |
| `repl` | — | Start once, query multiple times. Subcommands: `impact`, `affected-tests`, `dependents`, `dependencies`, `issues`, `top`, `audit-map` |

## Suggested Workflows

### New Project Assessment

```bash
workspace-bridge-cli audit-summary --cwd <project> --json --quiet
# If mixed repo, add --exclude
workspace-bridge-cli audit-summary --cwd <project> --exclude prototypes,reference --json --quiet
```

### Pre-Refactoring Analysis

```bash
workspace-bridge-cli audit-overview --cwd <project> --json --quiet
# Identify hotspots and fragile modules
workspace-bridge-cli audit-file --cwd <project> --file <target-file> --json --quiet
# Understand impact before changing
```

### PR Validation

```bash
workspace-bridge-cli audit-diff --cwd <project> --json --quiet
# Get validation plan with concrete commands
# Run suggested commands in smoke → focused → full order
```

### Incremental Analysis (Noise Reduction)

Use these when you only care about the current change, not the entire codebase:

```bash
# Only show dead-exports / unresolved / cycles related to changed files
workspace-bridge-cli audit-diff --cwd <project> --incremental --json --quiet

# File save → auto-print impact + affected tests (JSON Lines event stream)
workspace-bridge-cli watch --cwd <project> --json --quiet

# File save → auto-run affected tests and stream results
workspace-bridge-cli watch --cwd <project> --run-tests --json --quiet
```

> `audit-diff` defaults to working tree vs HEAD. Use `--since <commit>` for arbitrary commit ranges without checkout.

### Multi-repo Audit (Batch)

```bash
# Shell loop
for dir in */; do
  echo "=== $dir ==="
  workspace-bridge-cli audit-summary --cwd "$dir" --format jsonl --quiet
done
```

Or use the provided aggregation script:
```bash
node scripts/multi-repo-audit.js <parent-directory>
```

## Review Dimensions

> **关键认知**：workspace-bridge 只做**结构分析**（谁依赖谁、改了什么、哪里耦合高）。**语义分析**（安全配置、并发逻辑、业务规则）是 AI 的能力圈，CLI 帮不上。
>
> 实战复盘数据：AI 自行审查代码逻辑（NPE、事务、N+1）检出率 ~70%；安全问题（接口鉴权、密钥、并发安全、日志泄露）检出率接近 **0%**，因为 AI 误以为 CLI 已经扫过了。

| Dimension | CLI 能帮什么 | AI 必须自己看什么 |
|-----------|-------------|------------------|
| **Structural** | `dead-exports`（0 引用符号）、`unresolved`（断链 import）、`cycles`（循环依赖）、`hotspots`（高耦合+高变更文件）、`impact`（变更影响半径） | 确认框架/runtime 是否隐式消费（Spring DI、Vue 模板、反射调用） |
| **Logic** | **—**（CLI 不理解代码逻辑） | NPE、事务边界、重复代码、边界条件 |
| **Security — Injection** | `audit-security --builtin-only` 可发现：`eval`/`innerHTML`/`document.write`、硬编码密钥（`password=xxx` 8+ 字符）、日志打印敏感字段（`console.log(token)`）、文件上传 API（`MultipartFile`/`transferTo`） | XSS beyond `innerHTML`、SQL 注入 beyond `${}`（动态 JPQL/QueryDSL）、Auth gaps（`@Anonymous`/`permitAll()`）、水平越权、SSE/WS 鉴权 |
| **Security — Config** | **—**（CLI 不解析配置语义） | `application.yml`/`.env` 明文密钥、Spring Security 配置通配符、`CORS` 开放范围 |
| **Concurrency** | **—**（CLI 不理解锁语义） | 乐观锁（`version` 字段）、幂等性（重复提交）、竞态条件、分布式锁 |
| **File Upload** | `audit-security` 能标记 `MultipartFile`/`transferTo` 存在 | 路径遍历防护、文件名白名单、存储目录隔离、任意文件删除/写入 |
| **Config/Ops** | **—** | 超时配置、错误处理、日志脱敏（`LogAspect` 是否过滤敏感字段） |
| **AGENTS context** | **—** | **Read AGENTS.md first.** 提取红线 → 逐项 check-list。跟踪已知缺口是否已修复。 |

## Fast vs Slow Commands

> Based on cache hit. First cold start (1000+ files) 5-30s, independent of command.

- **Fast** (< 2s): `workspace-info`, `audit-summary`, `audit-file`, `audit-map`, `stats`, `health`, `dead-exports`, `unresolved`, `cycles`, `impact`, `affected-tests`, `diagnostics`, `audit-security --builtin-only`
- **Medium** (2-5s): `audit-diff`, `audit-overview`（both involve `git log`）

## Interpretation

### Capability Value Matrix

| Capability | Value | Best Use | Caveat |
|-----------|-------|----------|--------|
| Hotspot detection | **High** | Know which files to avoid touching without tests | Structural (churn × coupling), not semantic risk |
| Unresolved imports | **High** | Find real broken references | Vue/Vite may omit `.vue` extension — verify before treating as bug |
| Cycle detection | **Medium-High** | Flag architectural debt | Some cycles are framework-legitimate (Vue store ↔ utils) |
| Dead export direction | **Medium** | Monthly cleanup of 0-reference files | Auto-downgraded to `low` for Java constants-warehouses; still verify reflection/static import consumers |
| Project structure (audit-map) | **High** | New session orientation without reading 500 files | Use `--compact` for 500+ file repos |
| Stability / fragile | **Low-Medium** | New project files default "fragile" (base score 45 + no tests = threshold) | Prefer hotspot over stability for risk assessment |
| Architecture advice | **Low** | "Split by subdomain" unrealistic for monoliths | Treat as reference only |
| Hygiene checks | **Low** | Missing `.editorconfig` / CI suggestions | Skip if project has established conventions |
| **Security scan (`--builtin-only`)** | **Medium** | 快速扫 eval/innerHTML/硬编码密钥/日志敏感/文件上传 API | **只覆盖正则模式匹配**。接口鉴权、Spring Security 配置、SSE/WS 鉴权、并发安全、配置文件审计 **完全不在范围内**，必须 AI 手动审查 |
| **Code logic review** | **—** | — | CLI 不做语义分析。NPE、事务、并发、重复代码全靠 AI 自己看 |

> Trust `unresolved` and `hotspots` first. Treat `dead-exports` as candidates, not verdicts. Ignore `architectureAdvice` for monoliths under 200 files.

### Result Confidence

| Finding | Confidence | Action |
|---------|------------|--------|
| `dead-exports` with no importers | High | Candidate for deletion (verify dynamic loading) |
| `unresolved` imports | High | Likely broken, inspect immediately |
| `cycles` | High | Actionable architectural debt |
| `orphans.modules` | Medium | Verify if actually unused (may be entry/config) |
| `hotspots` | Medium-High | High churn + coupling, review carefully |
| `stability` fragile | Medium | Add tests before refactoring |

### Language Support Matrix

| Language | Dependency Graph | Symbol Impact | Dead Exports | Test Mapping | Stack Commands | Known Gaps |
|----------|------------------|---------------|--------------|--------------|----------------|------------|
| JS/TS    | ✅ Full AST      | ✅ Symbol-level | ✅ Symbol-level | ✅ Graph + Heuristic | ✅ Full | Custom aliases need `tsconfig.json` paths |
| Python   | ✅ Full AST      | ✅ Module-level | ✅ `__all__` aware | ✅ Graph + Heuristic | ✅ Full | |
| Java     | ✅ AST (javalang) | ✅ Symbol-level | ✅ Symbol-level | ✅ Graph + Heuristic | ✅ Full (Maven/Gradle) | Multi-module requires `pom.xml` at root or one subdir deep |
| Kotlin   | ✅ AST (tree-sitter) | ✅ Symbol-level | ✅ Symbol-level | ✅ Graph + Heuristic | ⚠️ Gradle only | |
| Go       | ✅ AST (tree-sitter) | ✅ Symbol-level | ✅ Symbol-level | ✅ Graph + Heuristic | ✅ Basic | |
| Rust     | ✅ AST (tree-sitter) | ✅ Symbol-level | ✅ Symbol-level | ✅ Graph + Heuristic | ✅ Basic | |
| C/C++    | ⚠️ L2 Regex      | ⚠️ File-level   | ⚠️ File-level   | ⚠️ Heuristic only   | ✅ Basic | |
| Vue SFC  | ✅ Full AST (JS) | ✅ Symbol-level | ✅ Symbol-level | ✅ Graph + Heuristic | ✅ Full | Alias/`@/` resolution depends on `tsconfig.json` or common patterns |
| Svelte   | ✅ Full AST (JS) | ✅ Symbol-level | ✅ Symbol-level | ✅ Graph + Heuristic | ✅ Full | |

## Known Limitations

The CLI accounts for common false-positives:

- Frontend asset imports (`.json`, `.css`)
- Python relative imports
- TypeScript ESM source imports ending in `.js`
- Dynamic `import(...)` (AST-tracked, but alias resolution must succeed to link the target)

**Vue/Vite projects — expect these harmless findings until fully indexed:**

- **Unresolved imports** from `.vue` extension omission (`import App from './app'` → resolves to `app.vue` since v1.1.1, but may still report if `tsconfig.json`/`jsconfig.json` paths are missing).
- **Dead exports** on files only consumed via Vite alias (`@/utils/request`). Alias resolution reads `tsconfig.json`/`jsconfig.json` `compilerOptions.paths` and falls back to common patterns (`@/` → `src/`, `~/` → project root). If your alias is custom, add it to `tsconfig.json` paths.
- **Orphans** on `src/main.js` / `app.vue` — these are entry points. They should be auto-recognized; if not, verify the file is named exactly `main.js`/`main.ts`/`app.vue`.

**Java / Spring Boot projects — known false positives:**

- **Dead exports on constant warehouses** (`Constants.java`, `HttpStatus.java`, `UserConstants.java`): The CLI recognizes the constants-warehouse pattern and **auto-downgrades confidence to `low`** (`confidenceSource: 'java-constants-warehouse'`). `honesty-engine` counts these toward `possibleFalsePositives`. However, static import / reflection consumers are still invisible to static analysis — verify before deleting.
- **Dead exports on `@Service` / `@Controller` / `@Mapper`**: Spring DI resolves these at runtime. If a class has framework annotations but no static import references, it may be falsely flagged. Check `possibleFalsePositives.frameworkAnnotation` hint.
- **MyBatis Mapper interfaces**: Mapper XML bindings are runtime-resolved. Mapper interfaces with no Java-side direct imports are not dead code.

**Java multi-module projects:**

- If `pom.xml`/`build.gradle` is in a subdirectory (e.g. `backend/`) rather than the repo root, the CLI now scans one level deep to find it (v1.1.1+). If still missing, run the CLI from the module directory containing `pom.xml`.

**Framework boundaries** (static analysis cannot see these):
- Vue `<script setup>` exports used only in `<template>` may be flagged dead-export. AST does not bridge SFC template → script.
- Spring DI (`@Service`/`@Controller`/`@Mapper`) is runtime reflection. `framework-patterns.js` marks many as framework-managed, but custom stereotypes may slip through.
- MyBatis XML `<select id="...">` binds to Java interfaces at runtime. CLI cannot cross XML/Java boundary.
- Django ORM `Meta` / `signals` / `admin.site.register` side effects are not tracked as imports.

**`parserAvailability.skipped`**: Non-Node.js projects (Java/Python/Go) may show `skipped: true`. This field name is misleading — it means "tree-sitter WASM initialized without reading `package.json`" (a faster init path for non-Node projects), **not** "files were skipped". All source files are still parsed. Regex fallback only happens per-file when AST parsing actually fails.

**Hotspot `reason`**: Drawn from git history signals (`historyRisk.signals[0]`). A high-coupling new file may show "No tracked history" even though its real risk is many dependents. Trust `score`, not just `reason`.

**May still report**: False orphans (unrecognized entry files), mixed-repo pollution (use `--exclude`), command heuristics mismatches. Large repos: `audit-map` without `--compact` outputs 30k+ lines — always use `--compact` first.

## Handling Mixed Repositories

Create `.workspace-bridge.json` to mark `reference` / `archive` / `generated` directories. Prevents dead-export and orphan pollution from non-source code.

```json
{
  "directories": {
    "archive": ["reference", "prototypes"],
    "reference": [],
    "generated": ["dist", "build", ".next", "coverage"]
  }
}
```

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `command not recognized` | `npx workspace-bridge-cli ...` or `node <repo>/cli.js ...` |
| Permission denied | `test -d <project>` first |
| Empty results | Run `workspace-info --cwd <project>` to verify supported files found. `fileCount: 0` → check `pom.xml`/`build.gradle` (Java), `package.json` (Vue), or use `--exclude` (mixed repo) |
