---
name: workspace-audit
description: Use this skill when the goal is to audit a local codebase with workspace-bridge-cli, especially for repo-level summaries, file impact checks, dead export candidates, unresolved imports, cycles, health checks, or dependency drift.
---

# workspace-audit

Use this skill when the goal is to audit a local codebase with `workspace-bridge-cli` instead of going through MCP.

## Purpose

This skill wraps the local CLI for:

- top-level repo audit
- dead export candidates
- unresolved imports
- dependency impact
- affected tests
- project health
- outdated dependencies

## Command patterns

Run commands from the `workspace-bridge` repo root.

```bash
node cli.js audit-summary --cwd <project> --json --quiet
node cli.js audit-summary --cwd <project> --exclude prototypes/reference,archive --json --quiet
node cli.js audit-file --cwd <project> --file <relative-or-absolute-file> --json --quiet
node cli.js health --cwd <project> --json
node cli.js deps --cwd <project> --json
node cli.js dead-exports --cwd <project> --json
node cli.js unresolved --cwd <project> --json
node cli.js cycles --cwd <project> --json
node cli.js impact --cwd <project> --file <relative-or-absolute-file> --json
node cli.js affected-tests --cwd <project> --file <relative-or-absolute-file> --max-depth 5 --json
node cli.js diagnostics --cwd <project> --mode quick --json
```

## Usage rules

- Prefer `audit-summary` for the first pass on a repo.
- Prefer `audit-file` when the task is scoped to one file change.
- Prefer `--json` and summarize the result after parsing it.
- Prefer `--quiet` together with `--json` so stderr logs do not pollute automation.
- In research or monorepo-style workspaces, use `--exclude` to drop reference or archive trees before trusting the result.
- Read `summary.severity` first, then `summary.nextSteps`, then inspect detailed sections only as needed.
- Treat `dead-exports` as candidates, not automatic deletions.
- For `impact` and `affected-tests`, pass the file path explicitly.
- If the target repo is large, run `health` and `dead-exports` first, then narrow with `impact`.

## Suggested workflow

1. Run `audit-summary` to identify hygiene and graph-level issues.
2. If the user is changing a specific file, run `audit-file --file ...`.
3. Only fall back to raw `impact` / `affected-tests` / `dead-exports` when you need deeper detail than the aggregate command provides.

## Fast vs slow commands

- Fast: `audit-summary`, `audit-file`, `health`, `dead-exports`, `unresolved`, `cycles`, `impact`, `affected-tests`
- Potentially slow or network-bound: `deps`, `diagnostics`

Avoid `deps` in the default flow unless dependency drift is part of the task.

## Interpretation

- `dead-exports`: high-confidence only means “no importer was found by the graph”. Dynamic loading can still invalidate the result.
- `unresolved`: usually indicates broken imports, unsupported alias resolution, or generated files outside the graph.
- `cycles`: actionable architectural debt.
- `health`: good first-pass signal for missing project hygiene.
- `summary.severity`: repo-level or file-level triage, not a proof of breakage.

The CLI already accounts for several common false-positive sources:

- frontend asset imports (`.json`, `.css`)
- Python relative imports
- TypeScript ESM source imports ending in `.js`
- dynamic `import(...)`
