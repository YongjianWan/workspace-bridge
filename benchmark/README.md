# Performance Benchmark

This benchmark generates a synthetic repository tree (500+ files by default) and measures:

- `audit-summary` cold start
- `audit-diff` cold start
- `audit-summary` hot cache
- `audit-diff` hot cache
- `audit-diff` incremental (after extra file changes)
- `audit-diff` function-analysis scenario (changed-function mapping and hints)

It is designed to validate large-repo baseline behavior and cache benefit, not to emulate every real-world monorepo.

## Usage

```bash
npm run benchmark:perf
npm run benchmark
npm run benchmark:compare
npm run benchmark:ci
```

Optional flags:

```bash
node scripts/benchmark-perf.js --files 700 --changes 16 --max-ms 30000
node scripts/benchmark-perf.js --files 700 --changes 16 --max-ms 30000 --max-function-ms 12000
node scripts/benchmark-perf.js --files 650 --keep-fixture
```

## Guardrail policy

CI applies:

- `cold-index` (`cold.audit-summary`) must be `< 15000ms` (blocking)
- `hot-index` (`hot.audit-summary`) must be `< 500ms` (blocking)
- `function-analysis` (`function-analysis.audit-diff`) may regress up to `+20%` vs `main` baseline (warning only)

`benchmark:compare` loads baseline from `main:benchmark/results/latest.json` by default.
You can override with:

```bash
node benchmark/compare.js --base release/0.7
node benchmark/compare.js --base-file benchmark/results/latest-main.json
```

## Output

- Console timing summary.
- JSON report at `benchmark/results/latest.json`.
