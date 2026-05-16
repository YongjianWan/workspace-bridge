#!/usr/bin/env node
/**
 * Multi-repo audit aggregator.
 *
 * Usage:
 *   node scripts/multi-repo-audit.js <parent-directory>
 *
 * Iterates over immediate subdirectories, runs `audit-summary --format jsonl`
 * for each, and prints a consolidated severity report.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const parentDir = process.argv[2] || '.';
const entries = fs.readdirSync(parentDir, { withFileTypes: true });
const dirs = entries
  .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
  .map(e => path.join(parentDir, e.name));

// Detect CLI availability: prefer global/npx, fallback to repo-local cli.js
const repoCliPath = path.resolve(__dirname, '..', 'cli.js');
let cliCommand = 'workspace-bridge-cli';
let cliArgsPrefix = [];
const globalCheck = spawnSync(
  process.platform === 'win32' ? 'where' : 'which',
  ['workspace-bridge-cli'],
  { encoding: 'utf-8' }
);
if (globalCheck.status !== 0 && fs.existsSync(repoCliPath)) {
  cliCommand = process.execPath;
  cliArgsPrefix = [repoCliPath];
}

const results = [];

for (const dir of dirs) {
  const args = [...cliArgsPrefix, 'audit-summary', '--cwd', dir, '--format', 'jsonl', '--quiet'];
  const res = spawnSync(cliCommand, args, { encoding: 'utf-8' });

  let severity = 'unknown';
  let fileCount = 0;
  let deadExportsCount = 0;
  let unresolvedCount = 0;
  let cyclesCount = 0;
  let error = null;

  if (res.status !== 0 || res.error) {
    error = res.stderr?.trim() || res.error?.message || `exit ${res.status}`;
  } else {
    const lines = res.stdout.trim().split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj._type === 'summary' || obj.severity) {
          severity = obj.severity || severity;
          fileCount = obj.scope?.counts?.totalFiles ?? fileCount;
          deadExportsCount = obj.deadExportsCount ?? deadExportsCount;
          unresolvedCount = obj.unresolvedCount ?? unresolvedCount;
          cyclesCount = obj.cyclesCount ?? cyclesCount;
        }
      } catch {
        // ignore malformed lines
      }
    }
  }

  results.push({
    dir: path.basename(dir),
    severity,
    fileCount,
    deadExportsCount,
    unresolvedCount,
    cyclesCount,
    error,
  });
}

// Print consolidated table
console.log('\n# Multi-Repo Audit Summary\n');
console.log('| Repo | Severity | Files | Dead | Unresolved | Cycles | Status |');
console.log('|------|----------|-------|------|------------|--------|--------|');

for (const r of results) {
  const status = r.error ? `❌ ${r.error}` : '✅';
  console.log(
    `| ${r.dir} | ${r.severity} | ${r.fileCount} | ${r.deadExportsCount} | ${r.unresolvedCount} | ${r.cyclesCount} | ${status} |`
  );
}

// Overall assessment
const highRisk = results.filter(r => r.severity === 'high' && !r.error);
if (highRisk.length > 0) {
  console.log(`\n⚠️  High severity repos: ${highRisk.map(r => r.dir).join(', ')}`);
}
