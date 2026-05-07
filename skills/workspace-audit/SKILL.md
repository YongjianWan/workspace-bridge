---
name: workspace-audit
description: Use this skill when the goal is to audit a local codebase with workspace-bridge-cli, especially for repo-level summaries, file impact checks, project overview, dead export candidates, unresolved imports, cycles, health checks, or dependency drift. 触发词：代码审计, 仓库审计, 项目结构分析, 影响范围, 死代码检测, 循环依赖, 健康检查, 依赖漂移, 文件影响分析, 孤儿文件检测, 热点文件分析.
---
# workspace-audit

Use this skill when the goal is to audit a local codebase with `workspace-bridge-cli` instead of going through MCP.

## Purpose

This skill wraps the local CLI for:

- **Project overview** - Hotspots, stability scores, orphan detection
- **Top-level repo audit** - Health + dead exports + cycles + unresolved
- **File impact analysis** - Impact radius + affected tests
- **Change validation** - Structured validation plan with concrete commands
- **Dead export candidates** - Symbol-level dead code detection
- **Unresolved imports** - Broken import detection
- **Project health** - Basic hygiene checks
- **Dependency queries** - Direct dependencies/dependents of a file + graph stats

## Command patterns

Always execute against a target project path via `--cwd <project>`.
Never assume the current terminal directory is the project root.

### CLI resolution order (for random paths/new windows)

Use this fallback chain:

1. `npx workspace-bridge-cli ...` (most reliable — no global install needed)
2. `workspace-bridge-cli ...` (global command, if installed)
3. `node <workspace-bridge-repo>/cli.js ...` (repo-local fallback)

### Startup preflight (must run once per new target path)

```bash
workspace-bridge-cli workspace-info --cwd <project> --json --quiet
workspace-bridge-cli audit-summary --cwd <project> --json --quiet
```

If preflight fails, report exact failure class: path invalid / permission denied / not a git workspace / command missing / analysis degraded.

### Aggregate Commands (Recommended)

```bash
workspace-bridge-cli audit-summary --cwd <project> --json --quiet
workspace-bridge-cli audit-file --cwd <project> --file <file> --json --quiet
workspace-bridge-cli audit-diff --cwd <project> --json --quiet
workspace-bridge-cli audit-overview --cwd <project> --json --quiet
workspace-bridge-cli audit-map --cwd <project> --json --quiet
```

### Large Project Mode

For repositories with 500+ files, use `--compact` with `audit-map` to avoid information overload:

```bash
workspace-bridge-cli audit-map --cwd <project> --compact --json --quiet
```

Compact mode returns:
- **Directory skeleton** instead of per-file tree (`fileCount` + `totalFileCount` per directory)
- **Module-level edges** instead of file-level imports
- **highlightedFiles** array surfacing entry points and files with issues (dead exports, unresolved imports, cycles, orphans, hotspots)

Use full mode (`--json --quiet` without `--compact`) when you need complete file-level detail.

### Quick Queries (Single-purpose)

```bash
workspace-bridge-cli stats --cwd <project> --json --quiet
workspace-bridge-cli dependencies --cwd <project> --file <file> --json --quiet
workspace-bridge-cli dependents --cwd <project> --file <file> --json --quiet
```

With exclusions for mixed repos:
```bash
workspace-bridge-cli audit-summary --cwd <project> --exclude prototypes/reference,archive --json --quiet
```

### Raw Commands (When you need details)

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
workspace-bridge-cli repl --cwd <project>
workspace-bridge-cli watch --cwd <project> --json --quiet
workspace-bridge-cli init
```

## Usage rules

### Command Selection

| Scenario | Recommended Command | Why |
|----------|---------------------|-----|
| First time seeing repo | `audit-summary` | Overall health + structural issues |
| Changing specific file | `audit-file --file ...` | Impact + affected tests |
| Git worktree has changes | `audit-diff` | Validation plan + concrete commands |
| Planning refactoring | `audit-overview` | Hotspots + stability + orphans |
| Understanding project structure | `audit-map` | Directory tree + dependency edges + issue overlay. Use `--compact` for large repos |
| "Who depends on this file?" | `dependents --file ...` | Direct dependents list |
| "What does this file import?" | `dependencies --file ...` | Direct dependencies list |
| Deep dive on dead code | `dead-exports` | Symbol-level candidates |
| Quick project metadata | `workspace-info` | File counts, languages, entry points |
| Type/lint check current state | `diagnostics` | eslint/tsc/pyright/ruff output |
| Security scan | `audit-security` | Semgrep vulnerability findings |
| Interactive query mode | `repl` | Fast impact/tests queries without rebuild |
| Watch mode (continuous) | `watch` | Auto-print impact on file save |
| Initialize config | `init` | Generate `.workspace-bridge.json` in cwd |

### Options

- Prefer `--json` and summarize the result after parsing it.
- Prefer `--quiet` together with `--json` so stderr logs do not pollute automation.
- In research or monorepo-style workspaces, use `--exclude` to drop reference or archive trees.

### Reading Results

**audit-summary:**
1. Read `summary.severity` first (low/medium/high)
2. Read `summary.nextSteps` for prioritized actions
3. Check `scope.mainlineFiles` vs `scope.nonMainlineFiles` for mixed repo awareness

**audit-diff:**
1. Read `summary.fileTypeBreakdown` for changed file composition
2. Read `summary.changeMetrics` (+additions/-deletions) for change scale
3. Read `validationAdvice.changeType` (docs/config/tests/scripts/code)
4. Check `validationAdvice.stack` for detected tech stack
5. Use `validationAdvice.commands` for concrete commands to run
6. Prioritize `validationAdvice.topRiskActions` for immediate actions
7. Follow `validationAdvice.phases` in order (smoke → focused → full)

> `changeType` is inferred from `fileRole` as the single source of truth. Extension fallback only applies when `fileRole === 'library'`. This means `README.md` → docs, `package.json` → config, `.test.js` → tests, and `deploy.sh` → scripts are all driven by `inferFileRole()` rather than scattered regex checks.

**workspace-info:**
1. Check `scope.totalFiles` and `scope.languages` for project scale
2. Review `entryFiles` for project entry points
3. Use as a lightweight preflight before heavier commands

**diagnostics:**
1. Check `diagnostics.totalIssues` for immediate problems
2. Review `diagnostics.byFile` for per-file error/warning counts
3. Prioritize files with `error` severity over `warning`

**audit-security:**
1. Read `summary.totalFindings` for security issue count
2. Review `findings` array for severity + rule + file location
3. Run after code changes that touch untrusted input boundaries

**repl:**
1. Start once, query multiple times (dep-graph stays hot in memory)
2. Subcommands: `impact <file>`, `affected-tests <file>`, `dependents <file>`, `dependencies <file>`, `issues`, `top`, `audit-map`
3. Exit with `exit` or Ctrl+C

**watch:**
1. Auto-detects file saves and prints impact + affected tests
2. Use `--compact` for large projects to keep output manageable
3. Press Ctrl+C to stop watching

**audit-map:**
1. Read `summary.severity` first (low/medium/high)
2. Read `summary.issueCounts` for issue distribution
3. Read `summary.nextSteps` for prioritized actions
4. Review `tree` for directory structure (or `highlightedFiles` in `--compact` mode)
5. Check `edges` for dependency relationships (module-level in `--compact`)

**audit-overview:**
1. Check `skeleton.coreModules` for key files to be careful with
2. Review `hotspots` for high-risk files (frequent changes + high coupling)
3. Review `stability` for fragile modules (low stability score)
4. Check `orphans` for potentially unused files (verify before deleting)
5. Review `architectureAdvice` for cycle/coupling refactor hints

## Standard Output Contract (for reusable skill behavior)

When this skill is used by an agent, the response should include:

1. `Scope`: target path and whether exclusions/config were applied
2. `Top Risks`: max 3 items with direct evidence fields
3. `Actions`: concrete executable commands in priority order
4. `Validation`: smoke/focused/full status or next commands
5. `Confidence`: high/medium/low and why

### Confidence rules

| Finding | Default Confidence | When to downgrade |
|---------|-------------------|-------------------|
| `unresolved` | High | Downgrade to **medium** if the project is Vue/Vite and the import omits `.vue` — verify manually before treating as broken. |
| `dead-exports` | Medium (AST) / Low (regex) | Downgrade to **low** if the file is consumed via alias (`@/...`) or dynamic import (`() => import(...)`). |
| `orphans` | Medium | Downgrade to **low** for `main.js`, `app.vue`, `index.js` — these are often entry points. |
| `cycles` | High | Rarely downgrade; cycles are structural facts. |
| `hotspots` | Medium-High | Downgrade if the file is a generated/config file rather than hand-written source. |

Avoid narrative-only output. Always return executable next steps.

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

## Fast vs Slow Commands

- **Fast** (< 2s): `audit-summary`, `audit-file`, `audit-overview`, `audit-diff`, `health`, `dead-exports`, `unresolved`, `cycles`, `impact`, `affected-tests`
- **Slow** (network-bound): `diagnostics`

## Interpretation

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

### Known Limitations

The CLI accounts for common false-positives:

- Frontend asset imports (`.json`, `.css`)
- Python relative imports
- TypeScript ESM source imports ending in `.js`
- Dynamic `import(...)` (AST-tracked, but alias resolution must succeed to link the target)

**Vue/Vite projects — expect these harmless findings until fully indexed:**

- **Unresolved imports** from `.vue` extension omission (`import App from './app'` → resolves to `app.vue` since v1.1.1, but may still report if `tsconfig.json`/`jsconfig.json` paths are missing).
- **Dead exports** on files only consumed via Vite alias (`@/utils/request`). Alias resolution reads `tsconfig.json`/`jsconfig.json` `compilerOptions.paths` and falls back to common patterns (`@/` → `src/`, `~/` → project root). If your alias is custom, add it to `tsconfig.json` paths.
- **Orphans** on `src/main.js` / `app.vue` — these are entry points. They should be auto-recognized; if not, verify the file is named exactly `main.js`/`main.ts`/`app.vue`.

**Java multi-module projects:**

- If `pom.xml`/`build.gradle` is in a subdirectory (e.g. `backend/`) rather than the repo root, the CLI now scans one level deep to find it (v1.1.1+). If still missing, run the CLI from the module directory containing `pom.xml`.

But still may report:

- **False orphans**: Entry files not recognized, framework-managed files
- **Mixed repo pollution**: Reference/prototypes not excluded
- **Mixed repo command heuristics**: Custom scripts may need manual adjustment
- **Large project information overload**: `audit-map` without `--compact` can output 30k+ lines on 1000-file repos. Always use `--compact` for initial reconnaissance on large codebases.

### Handling Mixed Repositories

Create `.workspace-bridge.json` in project root:

```json
{
  "directories": {
    "reference": ["prototypes", "reference", "examples"],
    "archive": ["archive", "legacy"],
    "generated": ["dist", "build", ".next", "coverage"]
  }
}
```

This prevents reference code from polluting dead export and orphan detection results.

## Troubleshooting

### "node is not recognized" or "workspace-bridge-cli is not recognized"

**Use npx (no install required):**
```bash
npx workspace-bridge-cli audit-summary --cwd <project> --json --quiet
```

**Use repo-local fallback:**
```bash
node <workspace-bridge-repo>/cli.js audit-summary --cwd <project> --json --quiet
```

### Permission denied on project path

Ensure the target path exists and is readable:
```bash
test -d <project> && workspace-bridge-cli audit-summary --cwd <project> --json --quiet
```

### Command runs but returns empty results

Check if project has supported files (JS/TS, Python, Java, Kotlin, Go, Rust, C/C++, Vue, Svelte):
```bash
npx workspace-bridge-cli workspace-info --cwd <project> --json --quiet
```

If `fileCount: 0` but the project clearly has source files:
- **Java**: ensure `pom.xml` or `build.gradle` exists at project root or one subdirectory deep.
- **Vue**: ensure `package.json` exists (Vue SFC is registered under the Node.js condition).
- **Mixed repo**: use `--exclude` to drop directories that confuse detection (e.g. `--exclude archive,reference`).


