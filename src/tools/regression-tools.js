/**
 * Regression tracking — compare current audit findings against a saved baseline.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DEFAULT_BASELINE_FILE = '.workspace-bridge-baseline.json';
const { SCHEMA_VERSION } = require('../config/constants');
const { stripBOM } = require('../utils/sanitize');
const { failure } = require('../utils/failure');

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
    schemaVersion: result.schemaVersion || SCHEMA_VERSION,
    timestamp: new Date().toISOString(),
    workspaceRoot: result.workspaceRoot,
    findings: extractFindings(result),
  };
}

function isWithinWorkspace(root, target) {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function isGeneratedBaseline(data) {
  return data && typeof data.schemaVersion === 'string'
    && typeof data.timestamp === 'string' && Number.isFinite(Date.parse(data.timestamp))
    && data.findings && ['deadExports', 'unresolved', 'cycles', 'healthGaps']
      .every((key) => Array.isArray(data.findings[key]));
}

function saveBaseline(result, filePath, workspaceRoot = result.workspaceRoot || process.cwd()) {
  const root = fs.realpathSync(workspaceRoot);
  const target = path.resolve(workspaceRoot, filePath);
  if (!isWithinWorkspace(path.resolve(workspaceRoot), target)
    || !isWithinWorkspace(root, fs.realpathSync(path.dirname(target)))) {
    throw new Error('Baseline save target must stay within the workspace');
  }
  const snapshot = buildBaselineSnapshot(result);
  let existing;
  try { existing = fs.lstatSync(target); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing && (!existing.isFile() || existing.nlink !== 1)) {
    throw new Error('Refusing to overwrite a linked or non-file baseline target');
  }
  // Exclusive creation and inode checks prevent a replaced target from being overwritten.
  const flags = existing
    ? fs.constants.O_RDWR | (fs.constants.O_NOFOLLOW || 0)
    : fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL;
  const fd = fs.openSync(target, flags);
  try {
    if (existing) {
      // The handle must be a plain single-link file, and the path must still name the file that
      // was inspected. Both identity reads use lstat: lstat and fstat do not report identical
      // dev/ino on every Node/libuv version, so mixing them gives false "changed" alarms.
      const opened = fs.fstatSync(fd);
      const current = fs.lstatSync(target);
      const moved = current.dev !== existing.dev || current.ino !== existing.ino;
      if (!opened.isFile() || opened.nlink !== 1 || !current.isFile() || moved) {
        throw new Error(`Baseline save target changed before overwrite (handle file=${opened.isFile()} nlink=${opened.nlink}; path dev ${existing.dev}->${current.dev} ino ${existing.ino}->${current.ino})`);
      }
    }
    if (existing) {
      let data;
      try { data = JSON.parse(stripBOM(fs.readFileSync(fd, 'utf8'))); }
      catch (error) { throw new Error('Refusing to overwrite a non-generated baseline file', { cause: error }); }
      if (!isGeneratedBaseline(data)) throw new Error('Refusing to overwrite a non-generated baseline file');
    }
    const buffer = Buffer.from(JSON.stringify(snapshot, null, 2));
    let offset = 0;
    while (offset < buffer.length) {
      offset += fs.writeSync(fd, buffer, offset, buffer.length - offset, offset);
    }
    fs.ftruncateSync(fd, buffer.length);
  } finally { fs.closeSync(fd); }
  return { ok: true, filePath };
}

function loadBaseline(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(stripBOM(raw));
    if (!data.findings) return failure('validation_error', 'Invalid baseline file: missing findings');
    return { ok: true, data };
  } catch (err) {
    return failure('path_error', `Failed to load baseline: ${err.message}`);
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
    return failure('git_error', `Invalid commit: ${commit}`);
  }
  let stdout;
  try {
    stdout = execFileSync('git', ['diff', '--name-only', `${commit}...HEAD`], { cwd, encoding: 'utf8', stdio: 'pipe' });
  } catch {
    return failure('git_error', `Failed to get diff for commit: ${commit}`);
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
    saveBaseline(result, savePath, cwd);
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
