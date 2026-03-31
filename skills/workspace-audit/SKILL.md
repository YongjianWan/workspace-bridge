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

Run commands from the `workspace-bridge` repo root.

### Aggregate Commands (Recommended)

```bash
# First pass on any repo
node cli.js audit-summary --cwd <project> --json --quiet

# With exclusions for mixed repos
node cli.js audit-summary --cwd <project> --exclude prototypes/reference,archive --json --quiet

# Single file impact analysis
node cli.js audit-file --cwd <project> --file <relative-or-absolute-file> --json --quiet

# Current git changes validation (with tech stack detection + commands)
node cli.js audit-diff --cwd <project> --json --quiet

# Project panoramic view (hotspots + stability + orphans)
node cli.js audit-overview --cwd <project> --json --quiet
```

### Raw Commands (When you need details)

```bash
node cli.js health --cwd <project> --json
node cli.js dead-exports --cwd <project> --json
node cli.js unresolved --cwd <project> --json
node cli.js cycles --cwd <project> --json
node cli.js impact --cwd <project> --file <file> --json
node cli.js affected-tests --cwd <project> --file <file> --max-depth 5 --json
node cli.js deps --cwd <project> --json
node cli.js diagnostics --cwd <project> --mode quick --json
```

## Usage rules

### Command Selection

| Scenario | Recommended Command | Why |
|----------|---------------------|-----|
| First time seeing repo | `audit-summary` | Overall health + structural issues |
| Changing specific file | `audit-file --file ...` | Impact + affected tests |
| Git worktree has changes | `audit-diff` | Validation plan + concrete commands |
| Planning refactoring | `audit-overview` | Hotspots + stability + orphans |
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
4. Follow `validationAdvice.phases` in order (smoke → focused → full)

**audit-overview:**
1. Check `skeleton.coreModules` for key files to be careful with
2. Review `hotspots` for high-risk files (frequent changes + high coupling)
3. Review `stability` for fragile modules (low stability score)
4. Check `orphans` for potentially unused files (verify before deleting)

## Suggested Workflows

### New Project Assessment
```bash
node cli.js audit-summary --cwd <project> --json --quiet
# If mixed repo, add --exclude
node cli.js audit-summary --cwd <project> --exclude prototypes,reference --json --quiet
```

### Pre-Refactoring Analysis
```bash
node cli.js audit-overview --cwd <project> --json --quiet
# Identify hotspots and fragile modules
node cli.js audit-file --cwd <project> --file <target-file> --json --quiet
# Understand impact before changing
```

### PR Validation
```bash
node cli.js audit-diff --cwd <project> --json --quiet
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

### Known Limitations

The CLI accounts for common false-positives:
- Frontend asset imports (`.json`, `.css`)
- Python relative imports
- TypeScript ESM source imports ending in `.js`
- Dynamic `import(...)`

But still may report:
- **False orphans**: Entry files not recognized, framework-managed files
- **Mixed repo pollution**: Reference/prototypes not excluded
- **Python tech stack**: May identify as `npm` instead of `pytest`

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

## Version

This skill targets workspace-bridge v0.8.0+
