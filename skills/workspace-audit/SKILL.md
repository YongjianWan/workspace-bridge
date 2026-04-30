---
name: workspace-audit
description: Use this skill when the goal is to audit a local codebase with workspace-bridge-cli, especially for repo-level summaries, file impact checks, project overview, dead export candidates, unresolved imports, cycles, health checks, or dependency drift.
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

## Command patterns

Always execute against a target project path via `--cwd <project>`.
Never assume the current terminal directory is the project root.

### CLI resolution order (for random paths/new windows)

Use this fallback chain:

1. `workspace-bridge-cli ...` (global command)
2. `node <workspace-bridge-repo>/cli.js ...` (repo-local fallback)
3. `node <workspace-bridge-repo>/scripts/cli-fallback.js ...` (scripted auto-fallback wrapper)

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

With exclusions for mixed repos:
```bash
workspace-bridge-cli audit-summary --cwd <project> --exclude prototypes/reference,archive --json --quiet
```

### Raw Commands (When you need details)

```bash
workspace-bridge-cli health --cwd <project> --json
workspace-bridge-cli dead-exports --cwd <project> --json
workspace-bridge-cli unresolved --cwd <project> --json
workspace-bridge-cli cycles --cwd <project> --json
workspace-bridge-cli impact --cwd <project> --file <file> --json
workspace-bridge-cli affected-tests --cwd <project> --file <file> --max-depth 5 --json
```

## Usage rules

### Command Selection

| Scenario | Recommended Command | Why |
|----------|---------------------|-----|
| First time seeing repo | `audit-summary` | Overall health + structural issues |
| Changing specific file | `audit-file --file ...` | Impact + affected tests |
| Git worktree has changes | `audit-diff` | Validation plan + concrete commands |
| Planning refactoring | `audit-overview` | Hotspots + stability + orphans |
| Understanding project structure | `audit-map` | Directory tree + dependency edges + issue overlay |
| Deep dive on dead code | `dead-exports` | Symbol-level candidates |

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
1. Read `validationAdvice.changeType` (docs/config/tests/scripts/code)
2. Check `validationAdvice.stack` for detected tech stack
3. Use `validationAdvice.commands` for concrete commands to run
4. Prioritize `validationAdvice.topRiskActions` for immediate actions
5. Follow `validationAdvice.phases` in order (smoke → focused → full)

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
- **Slow** (network-bound): `deps`, `diagnostics`

Avoid `deps` in the default flow unless dependency drift is part of the task.

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

| Language | Dependency Graph | Symbol Impact | Dead Exports | Test Mapping | Stack Commands |
|----------|------------------|---------------|--------------|--------------|----------------|
| JS/TS    | ✅ Full AST      | ✅ Symbol-level | ✅ Symbol-level | ✅ Graph + Heuristic | ✅ Full |
| Python   | ✅ Full AST      | ✅ Module-level | ✅ `__all__` aware | ✅ Graph + Heuristic | ✅ Full |
| Java     | ✅ AST (javalang) | ✅ Symbol-level | ✅ Symbol-level | ✅ Graph + Heuristic | ✅ Full (Maven/Gradle) |
| Kotlin   | ⚠️ L2 Regex      | ⚠️ File-level   | ⚠️ File-level   | ⚠️ Heuristic only   | ⚠️ Gradle only |
| Go       | ⚠️ L2 Regex      | ⚠️ File-level   | ⚠️ File-level   | ⚠️ Heuristic only   | ✅ Basic |
| Rust     | ⚠️ L2 Regex      | ⚠️ File-level   | ⚠️ File-level   | ⚠️ Heuristic only   | ✅ Basic |

### Known Limitations

The CLI accounts for common false-positives:

- Frontend asset imports (`.json`, `.css`)
- Python relative imports
- TypeScript ESM source imports ending in `.js`
- Dynamic `import(...)`

But still may report:

- **False orphans**: Entry files not recognized, framework-managed files
- **Mixed repo pollution**: Reference/prototypes not excluded
- **Mixed repo command heuristics**: Custom scripts may need manual adjustment

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

**Use repo-local fallback:**
```bash
node <workspace-bridge-repo>/cli.js audit-summary --cwd <project> --json --quiet
```

**Use scripted wrapper:**
```bash
node <workspace-bridge-repo>/scripts/cli-fallback.js audit-summary --cwd <project> --json --quiet
```

### Permission denied on project path

Ensure the target path exists and is readable:
```bash
test -d <project> && workspace-bridge-cli audit-summary --cwd <project> --json --quiet
```

### Command runs but returns empty results

Check if project has supported files (JS/TS/Python/Java/Kotlin/Go/Rust):
```bash
workspace-bridge-cli workspace-info --cwd <project> --json --quiet
```

## Version

This skill targets workspace-bridge v0.9.0+
