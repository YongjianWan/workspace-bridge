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

## Threshold Strategy (Relative Baseline + Tolerance)

The compare script uses **relative comparison** against baseline when available, with **absolute safety caps** as fallbacks:

- If baseline exists → threshold = `min(base * (1 + tolerance), absolute_max)`
- If no baseline → use `absolute_max` only

Default settings:

| Metric | Tolerance | Absolute Cap |
|--------|-----------|--------------|
| cold-index | +30% | 15000ms |
| hot-index | +30% | 2000ms |
| function-analysis | +30% | 120000ms |

### Why Relative?

Fixed thresholds (e.g., `hot-index < 500ms`) are prone to environmental noise. The new strategy:

1. Allows natural variance within ±30% of baseline
2. Still catches significant regressions (>30% slower)
3. Prevents extreme outliers via absolute caps

### Override Options

```bash
# Use different tolerance (default 0.3 = 30%)
node benchmark/compare.js --tolerance 0.5

# Use absolute thresholds only (disable relative)
node benchmark/compare.js --no-relative

# Custom absolute caps
node benchmark/compare.js --hot-max-ms 3000 --cold-max-ms 20000

# Different baseline source
node benchmark/compare.js --base release/0.7
node benchmark/compare.js --base-file benchmark/results/latest-main.json
```

## CI Policy

`benchmark:ci` runs both `benchmark` and `benchmark:compare`:

- **Blocking**: Any metric exceeds its calculated threshold
- **Warning**: Regression detected but within safety cap
- **Note**: First run on a new branch may use absolute thresholds until baseline is established

## Output

- Console timing summary with delta percentages
- JSON report at `benchmark/results/latest.json`
