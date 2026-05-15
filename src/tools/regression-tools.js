/**
 * Regression tracking — compare current audit findings against a saved baseline.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DEFAULT_BASELINE_FILE = '.workspace-bridge-baseline.json';

function makeDeadExportKey(item) {
  return `${item.file}#${item.name}`;
}

function makeUnresolvedKey(item) {
  return `${item.file}#${item.source}`;
}

function makeCycleKey(item) {
  return (item.files || []).slice().sort().join('->');
}

function makeHealthGapKey(checkName) {
  return checkName;
}

function compareCategory(current, previous, keyFn) {
  const currentSet = new Set(current.map(keyFn));
  const previousSet = new Set(previous.map(keyFn));
  return {
    fixed: previous.filter((p) => !currentSet.has(keyFn(p))),
    new: current.filter((c) => !previousSet.has(keyFn(c))),
    open: current.filter((c) => previousSet.has(keyFn(c))),
  };
}

function extractFindings(result) {
  return {
    deadExports: result.deadExports?.deadExports?.map((d) => ({
      file: d.file,
      name: d.name,
      confidence: d.confidence,
      severity: d.confidence || 'medium',
    })) || [],
    unresolved: result.unresolved?.unresolved?.map((u) => ({
      file: u.file,
      source: u.source,
      resolvedTo: u.resolvedTo,
    })) || [],
    cycles: result.cycles?.cycles?.map((c) => ({
      files: c.files,
      length: c.length,
    })) || [],
    healthGaps: result.health?.checks
      ? Object.entries(result.health.checks).filter(([, v]) => !v.found).map(([k]) => k)
      : [],
  };
}

function buildBaselineSnapshot(result) {
  return {
    schemaVersion: result.schemaVersion || '1.2.0',
    timestamp: new Date().toISOString(),
    workspaceRoot: result.workspaceRoot,
    findings: extractFindings(result),
  };
}

function saveBaseline(result, filePath) {
  const snapshot = buildBaselineSnapshot(result);
  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), 'utf8');
  return { ok: true, filePath };
}

function loadBaseline(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    if (!data.findings) return { ok: false, error: 'Invalid baseline file: missing findings' };
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: `Failed to load baseline: ${err.message}` };
  }
}

function checkRegression(currentResult, baselineFilePath) {
  const baselinePath = baselineFilePath || DEFAULT_BASELINE_FILE;
  const baseline = loadBaseline(baselinePath);
  if (!baseline.ok) return baseline;

  const current = extractFindings(currentResult);
  const previous = baseline.data.findings;

  return {
    ok: true,
    baselinePath,
    baselineTimestamp: baseline.data.timestamp,
    regression: {
      deadExports: compareCategory(current.deadExports, previous.deadExports || [], makeDeadExportKey),
      unresolved: compareCategory(current.unresolved, previous.unresolved || [], makeUnresolvedKey),
      cycles: compareCategory(current.cycles, previous.cycles || [], makeCycleKey),
      healthGaps: compareCategory(
        current.healthGaps.map((k) => ({ check: k })),
        (previous.healthGaps || []).map((k) => ({ check: k })),
        makeHealthGapKey
      ),
    },
  };
}

function checkRegressionAgainstCommit(currentResult, commit, cwd) {
  try {
    execSync(`git rev-parse --verify ${commit}`, { cwd, stdio: 'pipe' });
  } catch {
    return { ok: false, error: `Invalid commit: ${commit}` };
  }
  const stdout = execSync(`git diff --name-only ${commit}...HEAD`, { cwd, encoding: 'utf8', stdio: 'pipe' });
  const changed = new Set(stdout.trim().split(/\r?\n/).filter(Boolean));
  const current = extractFindings(currentResult);
  const byOrigin = (items, key = 'file') => ({
    new: items.filter((i) => changed.has(i[key])),
    legacy: items.filter((i) => !changed.has(i[key])),
  });
  return {
    ok: true,
    commit,
    regression: {
      deadExports: byOrigin(current.deadExports),
      unresolved: byOrigin(current.unresolved),
      cycles: {
        new: current.cycles.filter((c) => c.files.some((f) => changed.has(f))),
        legacy: current.cycles.filter((c) => !c.files.some((f) => changed.has(f))),
      },
      healthGaps: { new: [], legacy: byOrigin(current.healthGaps.map((k) => ({ check: k })), 'check').legacy },
    },
  };
}

module.exports = {
  saveBaseline,
  checkRegression,
  checkRegressionAgainstCommit,
  DEFAULT_BASELINE_FILE,
};
