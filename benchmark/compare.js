#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..');
const headPath = path.join(repoRoot, 'benchmark', 'results', 'latest.json');

function parseArgs(argv) {
  const options = {
    baseRef: 'main',
    baseFile: null,
    // Absolute thresholds as safety nets (when base is missing or extremely high)
    coldMaxMs: 15000,
    hotMaxMs: 3000,
    functionMaxMs: 120000,
    // Relative tolerance: how much regression is allowed vs baseline
    toleranceRatio: 0.3, // 30% tolerance by default
    // Whether to use relative comparison when baseline is available
    useRelative: true,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--base') options.baseRef = argv[++i] || options.baseRef;
    else if (arg === '--base-file') options.baseFile = argv[++i] || null;
    else if (arg === '--cold-max-ms') options.coldMaxMs = Number.parseInt(argv[++i] || '', 10);
    else if (arg === '--hot-max-ms') options.hotMaxMs = Number.parseInt(argv[++i] || '', 10);
    else if (arg === '--function-max-ms') options.functionMaxMs = Number.parseInt(argv[++i] || '', 10);
    else if (arg === '--tolerance') options.toleranceRatio = Number.parseFloat(argv[++i] || '');
    else if (arg === '--no-relative') options.useRelative = false;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readBaseJsonFromGitRef(baseRef) {
  const result = spawnSync('git', ['show', `${baseRef}:benchmark/results/latest.json`], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    return null;
  }
  return JSON.parse(result.stdout);
}

function metric(report, label) {
  const row = (report?.timings || []).find((entry) => entry.label === label);
  return Number.isFinite(row?.elapsedMs) ? row.elapsedMs : null;
}

function formatMs(value) {
  return value === null ? 'n/a' : `${value}ms`;
}

function percentageDelta(base, head) {
  if (!Number.isFinite(base) || base <= 0 || !Number.isFinite(head)) return null;
  return ((head - base) / base) * 100;
}

function printComparison(name, base, head, threshold) {
  const delta = percentageDelta(base, head);
  const deltaText = delta === null ? 'n/a' : `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`;
  const thresholdText = threshold ? ` (limit: ${formatMs(threshold)})` : '';
  console.log(
    `${name.padEnd(24)} base=${formatMs(base).padEnd(8)} head=${formatMs(head).padEnd(8)} delta=${deltaText.padEnd(8)}${thresholdText}`
  );
}

function calculateThreshold(baseValue, absoluteMax, toleranceRatio, useRelative) {
  // If no baseline, use absolute threshold
  if (!Number.isFinite(baseValue) || baseValue <= 0) {
    return { value: absoluteMax, type: 'absolute' };
  }
  // If relative comparison is disabled, use absolute threshold
  if (!useRelative) {
    return { value: absoluteMax, type: 'absolute' };
  }
  // Calculate relative threshold: base * (1 + tolerance)
  const relativeThreshold = baseValue * (1 + toleranceRatio);
  // Use the lower of relative threshold and absolute max (safety net)
  const finalThreshold = Math.min(relativeThreshold, absoluteMax);
  return {
    value: Math.round(finalThreshold),
    type: finalThreshold === relativeThreshold ? 'relative' : 'absolute-cap',
    base: baseValue,
    tolerance: toleranceRatio,
  };
}

function main() {
  const options = parseArgs(process.argv);
  const winScale = process.platform === 'win32' ? 4 : 1;
  options.coldMaxMs *= winScale;
  options.hotMaxMs *= winScale;
  options.functionMaxMs *= winScale;

  if (!fs.existsSync(headPath)) {
    throw new Error(`Head benchmark result missing: ${headPath}. Run benchmark first.`);
  }

  const head = readJsonFile(headPath);
  const base = options.baseFile
    ? readJsonFile(path.resolve(options.baseFile))
    : readBaseJsonFromGitRef(options.baseRef);

  console.log('Performance comparison');
  const baseSource = options.baseFile ? path.resolve(options.baseFile) : `git:${options.baseRef}`;
  console.log(`Base source: ${base ? baseSource : `${baseSource} (missing, using absolute thresholds)`}`);
  console.log(`Tolerance: ${(options.toleranceRatio * 100).toFixed(0)}%`);
  console.log('');

  const metricsToCompare = [
    { key: 'cold.audit-summary', label: 'cold-index', maxMs: options.coldMaxMs },
    { key: 'hot.audit-summary', label: 'hot-index', maxMs: options.hotMaxMs },
    { key: 'function-analysis.audit-diff', label: 'function-analysis', maxMs: options.functionMaxMs },
    { key: 'hot.audit-overview', label: 'hot-overview', maxMs: options.hotMaxMs },
    { key: 'hot.audit-file', label: 'hot-file', maxMs: options.hotMaxMs },
    { key: 'hot.tree', label: 'hot-tree', maxMs: options.hotMaxMs },
    { key: 'hot.audit-security', label: 'hot-security', maxMs: options.hotMaxMs },
    { key: 'hot.dead-exports', label: 'hot-dead-exports', maxMs: options.hotMaxMs },
    { key: 'hot.cycles', label: 'hot-cycles', maxMs: options.hotMaxMs },
    { key: 'hot.unresolved', label: 'hot-unresolved', maxMs: options.hotMaxMs },
  ];

  const blockingFailures = [];
  const warnings = [];

  for (const item of metricsToCompare) {
    const headVal = metric(head, item.key);
    const baseVal = metric(base || {}, item.key);

    const threshold = calculateThreshold(
      baseVal,
      item.maxMs,
      options.toleranceRatio,
      options.useRelative
    );

    printComparison(item.label, baseVal, headVal, threshold.value);

    if (headVal === null) {
      // If a metric is newly introduced and not measured, only fail if it's head that is missing.
      // (base is allowed to not have it for backward compatibility)
      blockingFailures.push(`${item.label}: no valid measurement in head`);
    } else if (headVal > threshold.value) {
      const thresholdType = threshold.type === 'absolute' ? 'absolute' : `relative (+${(options.toleranceRatio * 100).toFixed(0)}%)`;
      blockingFailures.push(
        `${item.label} ${formatMs(headVal)} > ${thresholdType} threshold ${formatMs(threshold.value)}`
      );
    }

    if (base && Number.isFinite(baseVal) && Number.isFinite(headVal)) {
      const regressionRatio = headVal / baseVal;
      if (regressionRatio > 1 + options.toleranceRatio && headVal <= threshold.value) {
        warnings.push(
          `${item.label} regressed by ${((regressionRatio - 1) * 100).toFixed(1)}% but within absolute safety cap (${item.maxMs}ms)`
        );
      }
    }
  }

  if (warnings.length > 0) {
    console.warn('\nWarnings:');
    for (const warning of warnings) {
      console.warn(`- ${warning}`);
    }
  }

  if (blockingFailures.length > 0) {
    console.error('\nBlocking failures:');
    for (const failure of blockingFailures) {
      console.error(`- ${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log('\nAll thresholds passed.');
  console.log('(Using relative thresholds with absolute safety caps)');
}

main();
