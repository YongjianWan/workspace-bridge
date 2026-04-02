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
    coldMaxMs: 15000,
    hotMaxMs: 500,
    functionRegressionRatio: 1.2,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--base') options.baseRef = argv[++i] || options.baseRef;
    else if (arg === '--base-file') options.baseFile = argv[++i] || null;
    else if (arg === '--cold-max-ms') options.coldMaxMs = Number.parseInt(argv[++i] || '', 10);
    else if (arg === '--hot-max-ms') options.hotMaxMs = Number.parseInt(argv[++i] || '', 10);
    else if (arg === '--function-regression') options.functionRegressionRatio = Number.parseFloat(argv[++i] || '');
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

function printComparison(name, base, head) {
  const delta = percentageDelta(base, head);
  const deltaText = delta === null ? 'n/a' : `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`;
  console.log(`${name.padEnd(20)} base=${formatMs(base).padEnd(8)} head=${formatMs(head).padEnd(8)} delta=${deltaText}`);
}

function main() {
  const options = parseArgs(process.argv);
  if (!fs.existsSync(headPath)) {
    throw new Error(`Head benchmark result missing: ${headPath}. Run benchmark first.`);
  }

  const head = readJsonFile(headPath);
  const base = options.baseFile
    ? readJsonFile(path.resolve(options.baseFile))
    : readBaseJsonFromGitRef(options.baseRef);

  const coldHead = metric(head, 'cold.audit-summary');
  const hotHead = metric(head, 'hot.audit-summary');
  const functionHead = metric(head, 'function-analysis.audit-diff');

  const coldBase = metric(base || {}, 'cold.audit-summary');
  const hotBase = metric(base || {}, 'hot.audit-summary');
  const functionBase = metric(base || {}, 'function-analysis.audit-diff');

  console.log('Performance comparison');
  const baseSource = options.baseFile ? path.resolve(options.baseFile) : `git:${options.baseRef}`;
  console.log(`Base source: ${base ? baseSource : `${baseSource} (missing, relative check skipped)`}`);
  printComparison('cold-index', coldBase, coldHead);
  printComparison('hot-index', hotBase, hotHead);
  printComparison('function-analysis', functionBase, functionHead);

  const blockingFailures = [];
  if (!Number.isFinite(coldHead) || coldHead > options.coldMaxMs) {
    blockingFailures.push(`cold-index ${formatMs(coldHead)} > ${options.coldMaxMs}ms`);
  }
  if (!Number.isFinite(hotHead) || hotHead > options.hotMaxMs) {
    blockingFailures.push(`hot-index ${formatMs(hotHead)} > ${options.hotMaxMs}ms`);
  }

  const warnings = [];
  if (base && Number.isFinite(functionBase) && Number.isFinite(functionHead)) {
    const threshold = functionBase * options.functionRegressionRatio;
    if (functionHead > threshold) {
      warnings.push(
        `function-analysis regressed by > ${(options.functionRegressionRatio * 100 - 100).toFixed(0)}% ` +
          `(${functionHead}ms vs baseline ${functionBase}ms)`
      );
    }
  } else {
    warnings.push('function-analysis baseline/head metric unavailable, skipped relative check');
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

  console.log('\nBlocking thresholds passed.');
}

main();
