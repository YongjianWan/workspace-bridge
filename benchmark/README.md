# Performance Benchmark

This benchmark generates a synthetic repository tree (500+ files by default) and measures:

- `audit-summary` cold start
- `audit-diff` cold start
- `audit-summary` hot cache
- `audit-diff` hot cache
- `audit-diff` incremental (after extra file changes)

It is designed to validate large-repo baseline behavior and cache benefit, not to emulate every real-world monorepo.

## Usage

```bash
npm run benchmark:perf
```

Optional flags:

```bash
node scripts/benchmark-perf.js --files 700 --changes 16 --max-ms 30000
node scripts/benchmark-perf.js --files 650 --keep-fixture
```

## Output

- Console timing summary.
- JSON report at `benchmark/results/latest.json`.

The script fails with exit code `1` if either cold metric exceeds the threshold:

- `cold.audit-summary`
- `cold.audit-diff`

Default threshold is `30000ms` and can be changed with `--max-ms`.
