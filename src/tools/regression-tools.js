/**
 * Regression tracking — compare current audit findings against a saved baseline.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DEFAULT_BASELINE_FILE = '.workspace-bridge-baseline.json';

function resolveBaseline(args) {
  let baselinePath = null;
  let commitBaseline = null;
  const cwd = args.cwd || process.cwd();
  if (args.baseline && typeof args.baseline === 'string') {
    const resolved = path.resolve(cwd, args.baseline);
    if (fs.existsSync(resolved)) {
      baselinePath = resolved;
    } else {
      let isValidCommit = false;
      try {
        execFileSync('git', ['rev-parse', '--verify', args.baseline], { cwd, stdio: 'pipe' });
        isValidCommit = true;
      } catch (_) {}
      if (isValidCommit) {
        commitBaseline = args.baseline;
      } else {
        throw new Error(`Baseline file not found: ${resolved}`);
      }
    }
  } else {
    baselinePath = path.resolve(cwd, DEFAULT_BASELINE_FILE);
    if (!fs.existsSync(baselinePath)) {
      throw new Error(`Baseline file not found: ${baselinePath}`);
    }
  }
  return { baselinePath, commitBaseline };
}

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
    const { stripBOM } = require('../utils/sanitize');
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(stripBOM(raw));
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

  const regression = {
    deadExports: compareCategory(current.deadExports, previous.deadExports || [], makeDeadExportKey),
    unresolved: compareCategory(current.unresolved, previous.unresolved || [], makeUnresolvedKey),
    cycles: compareCategory(current.cycles, previous.cycles || [], makeCycleKey),
    healthGaps: compareCategory(
      current.healthGaps.map((k) => ({ check: k })),
      (previous.healthGaps || []).map((k) => ({ check: k })),
      makeHealthGapKey
    ),
  };

  const hasNew =
    regression.deadExports.new.length > 0 ||
    regression.unresolved.new.length > 0 ||
    regression.cycles.new.length > 0 ||
    regression.healthGaps.new.length > 0;
  regression.status = hasNew ? 'degraded' : 'clean';

  return {
    ok: true,
    baselinePath,
    baselineTimestamp: baseline.data.timestamp,
    regression,
  };
}

function checkRegressionAgainstCommit(currentResult, commit, cwd) {
  try {
    execFileSync('git', ['rev-parse', '--verify', commit], { cwd, stdio: 'pipe' });
  } catch {
    return { ok: false, error: `Invalid commit: ${commit}` };
  }
  let stdout;
  try {
    stdout = execFileSync('git', ['diff', '--name-only', `${commit}...HEAD`], { cwd, encoding: 'utf8', stdio: 'pipe' });
  } catch {
    return { ok: false, error: `Failed to get diff for commit: ${commit}` };
  }
  const changed = new Set(stdout.trim().split(/\r?\n/).filter(Boolean));
  const current = extractFindings(currentResult);
  const byOrigin = (items, key = 'file') => ({
    new: items.filter((i) => changed.has(i[key])),
    legacy: items.filter((i) => !changed.has(i[key])),
  });
  const regression = {
    deadExports: byOrigin(current.deadExports),
    unresolved: byOrigin(current.unresolved),
    cycles: {
      new: current.cycles.filter((c) => c.files.some((f) => changed.has(f))),
      legacy: current.cycles.filter((c) => !c.files.some((f) => changed.has(f))),
    },
    healthGaps: { new: [], legacy: byOrigin(current.healthGaps.map((k) => ({ check: k })), 'check').legacy },
  };
  const hasNew =
    regression.deadExports.new.length > 0 ||
    regression.unresolved.new.length > 0 ||
    regression.cycles.new.length > 0 ||
    regression.healthGaps.new.length > 0;
  regression.status = hasNew ? 'degraded' : 'clean';
  return {
    ok: true,
    commit,
    regression,
  };
}

function applyBaselineOperations(result, args) {
  const cwd = args.cwd || process.cwd();
  if (args.save) {
    const saveFilename = typeof args.save === 'string' ? args.save : DEFAULT_BASELINE_FILE;
    const savePath = path.resolve(cwd, saveFilename);
    saveBaseline(result, savePath);
    result.baselineSaved = savePath;
  }

  if (args.checkRegression) {
    const { baselinePath, commitBaseline } = resolveBaseline(args);
    if (commitBaseline) {
      const regResult = checkRegressionAgainstCommit(result, commitBaseline, cwd);
      result.regression = { ok: regResult.ok, ...regResult.regression, commit: regResult.commit, error: regResult.error };
    } else {
      const regResult = checkRegression(result, baselinePath);
      result.regression = { ok: regResult.ok, ...regResult.regression, baselinePath: regResult.baselinePath, baselineTimestamp: regResult.baselineTimestamp, error: regResult.error };
    }
  }
}

module.exports = {
  saveBaseline,
  checkRegression,
  checkRegressionAgainstCommit,
  DEFAULT_BASELINE_FILE,
  resolveBaseline,
  applyBaselineOperations,
};
