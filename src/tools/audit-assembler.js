/**
 * audit-assembler.js - L4 Curation Facade Layer
 * Down-shifts all result curation, filtering, baseline checking,
 * and aggregation logic from the CLI command handlers.
 */
const fs = require('fs');
const path = require('path');
const { projectHealth } = require('./health-tools');
const { dependencyGraph } = require('./dep-tools');
const {
  buildRepoSummary,
  buildAuditDiffSummary,
  buildValidationAdvice,
  buildImpactExplanations,
  compactChangedFile,
  buildFileSummary,
  buildFileValidationAdvice
} = require('../cli/formatters');
const { getChangedFiles, getChangedLineRanges, getFileHistoryRisk, getDiffNumstat } = require('./git-tools');
const { resolveWorkspaceFilePath } = require('../utils/path');
const { mapWithConcurrency } = require('../utils/async');
const { DEFAULTS } = require('../config/constants');
const { auditSecurity, groupBySeverity } = require('./security-tools');
const { buildCompositeRisk } = require('../cli/formatters');

const SEVERITY_RANK = { high: 3, medium: 2, low: 1 };

function severityMeetsFilter(itemSeverity, minSeverity) {
  if (!minSeverity || !SEVERITY_RANK[minSeverity]) return true;
  return (SEVERITY_RANK[itemSeverity] || 0) >= SEVERITY_RANK[minSeverity];
}

async function assembleSummary(parsed, container) {
  const regressionTools = require('./regression-tools');

  if (parsed.checkRegression) {
    regressionTools.resolveBaseline(parsed);
  }

  const [health, deadExports, unresolved, cycles] = await Promise.all([
    projectHealth({ cwd: parsed.cwd }, container),
    dependencyGraph({ cwd: parsed.cwd, operation: 'dead_exports' }, container),
    dependencyGraph({ cwd: parsed.cwd, operation: 'unresolved' }, container),
    dependencyGraph({ cwd: parsed.cwd, operation: 'cycles' }, container),
  ]);

  if (parsed.severity && deadExports.ok && deadExports.deadExports) {
    const filtered = deadExports.deadExports.filter((d) => severityMeetsFilter(d.confidence, parsed.severity));
    deadExports.deadExports = filtered;
    deadExports.deadExportsCount = filtered.length;
    if (deadExports.possibleFalsePositives) {
      deadExports.possibleFalsePositives.count = filtered.length;
      deadExports.possibleFalsePositives.total = filtered.length;
      if (filtered.length === 0) {
        deadExports.possibleFalsePositives.primaryReason = 'unknown';
        deadExports.possibleFalsePositives.reasons = [];
        deadExports.possibleFalsePositives.disclaimer = null;
      }
    }
  }

  const scope = container.snapshot.graph.getScopeSummary();
  const { detectStack } = require('../utils/stack-detectors/detect');
  const stack = detectStack(container.workspaceRoot);
  const stats = container.snapshot.graph.getStats();
  const filteredAnalysisCoverage = stats.filteredAnalysisCoverage || stats.analysisCoverage || null;

  const result = {
    ok: [health, deadExports, unresolved, cycles].every((r) => r.ok !== false),
    workspaceRoot: container.workspaceRoot,
    scope,
    summary: buildRepoSummary(health, deadExports, unresolved, cycles, scope, stack.profile, filteredAnalysisCoverage, stack),
    health,
    deadExports,
    unresolved,
    cycles,
  };

  if (parsed.save) {
    const saveFilename = typeof parsed.save === 'string' ? parsed.save : regressionTools.DEFAULT_BASELINE_FILE;
    const savePath = path.resolve(parsed.cwd || process.cwd(), saveFilename);
    regressionTools.saveBaseline(result, savePath);
    result.baselineSaved = savePath;
  }

  if (parsed.checkRegression) {
    let baselinePath = null;
    let commitBaseline = null;
    if (parsed.baseline && typeof parsed.baseline === 'string') {
      const resolved = path.resolve(parsed.cwd || process.cwd(), parsed.baseline);
      if (fs.existsSync(resolved)) {
        baselinePath = resolved;
      } else {
        commitBaseline = parsed.baseline;
      }
    } else {
      // Default baseline file resolved against target cwd
      baselinePath = path.resolve(parsed.cwd || process.cwd(), regressionTools.DEFAULT_BASELINE_FILE);
    }
    if (commitBaseline) {
      const regResult = regressionTools.checkRegressionAgainstCommit(result, commitBaseline, parsed.cwd || process.cwd());
      result.regression = { ok: regResult.ok, ...regResult.regression, commit: regResult.commit, error: regResult.error };
    } else {
      const regResult = regressionTools.checkRegression(result, baselinePath);
      result.regression = { ok: regResult.ok, ...regResult.regression, baselinePath: regResult.baselinePath, baselineTimestamp: regResult.baselineTimestamp, error: regResult.error };
    }
  }

  // Calculate hasFindings O(1) return contract
  result.hasFindings =
    (result.deadExports?.deadExportsCount || 0) > 0 ||
    (result.unresolved?.unresolvedCount || 0) > 0 ||
    (result.cycles?.cyclesCount || 0) > 0 ||
    (result.health?.healthScoreNumeric?.ratio || 1) < 1;

  return result;
}

function buildChangeMetrics(numstat, changed) {
  if (!numstat.ok) return null;
  return {
    totalAdditions: numstat.totalAdditions,
    totalDeletions: numstat.totalDeletions,
    changedFileCount: numstat.files.length,
    untrackedFileCount: Math.max(0, changed.changedFiles.length - numstat.files.length),
  };
}

async function buildDiffEntry(relativeFile, container, parsed) {
  const { since, commits, staged, reuseHints: reuseHintsFlag, quiet, maxDepth } = parsed;
  const resolvedPath = resolveWorkspaceFilePath(relativeFile, container.workspaceRoot);
  const classification = container.projectContext?.classifyFile(resolvedPath) || null;
  const graphKnown = Boolean(resolvedPath && container.snapshot.graph.hasFile(resolvedPath));
  const impact = graphKnown ? container.snapshot.graph.getImpactRadius(resolvedPath) : [];
  let changedLineRanges = [];
  if (resolvedPath) {
    if (commits) {
      const rangeResult = await getChangedLineRanges(container.workspaceRoot, resolvedPath, { commits }).catch(() => ({ ok: false }));
      if (rangeResult.ok) changedLineRanges = rangeResult.lineRanges;
    } else if (since) {
      const rangeResult = await getChangedLineRanges(container.workspaceRoot, resolvedPath, { since }).catch(() => ({ ok: false }));
      if (rangeResult.ok) changedLineRanges = rangeResult.lineRanges;
    } else if (staged) {
      const stagedResult = await getChangedLineRanges(container.workspaceRoot, resolvedPath, { staged: true }).catch(() => ({ ok: false }));
      if (stagedResult.ok) changedLineRanges = stagedResult.lineRanges;
    } else {
      const [unstagedResult, stagedResult] = await Promise.all([
        getChangedLineRanges(container.workspaceRoot, resolvedPath, { staged: false }).catch(() => ({ ok: false })),
        getChangedLineRanges(container.workspaceRoot, resolvedPath, { staged: true }).catch(() => ({ ok: false })),
      ]);
      const ranges = [];
      if (unstagedResult.ok) ranges.push(...unstagedResult.lineRanges);
      if (stagedResult.ok) ranges.push(...stagedResult.lineRanges);
      const seen = new Set();
      changedLineRanges = ranges.filter((r) => {
        const key = `${r.startLine}-${r.endLine}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).sort((a, b) => a.startLine - b.startLine);
    }
  }
  const baseSymbolImpact = graphKnown ? container.snapshot.graph.getSymbolImpact(resolvedPath) : null;
  const changedFunctionImpactBase = graphKnown
    ? container.snapshot.graph.getChangedFunctionImpact(resolvedPath, changedLineRanges, { symbolImpact: baseSymbolImpact })
    : null;
  let reuseHints = [];
  if (reuseHintsFlag === 'on' && graphKnown && changedFunctionImpactBase?.mode === 'function-symbol') {
    try {
      reuseHints = container.snapshot.graph.getFunctionReuseHints(resolvedPath, changedFunctionImpactBase.changedFunctions, {
        minScore: DEFAULTS.REUSE_HINTS_MIN_SCORE,
        maxPerFunction: DEFAULTS.REUSE_HINTS_MAX_PER_FUNCTION,
      });
    } catch (e) {
      if (!quiet) {
        console.error(`[warn] reuse hints failed for ${relativeFile}: ${e?.message || String(e)}`);
      }
      reuseHints = [];
    }
  }
  const functionLevelAffectedTests = graphKnown &&
    (changedFunctionImpactBase?.mode === 'function-symbol' || changedFunctionImpactBase?.mode === 'internal-function-call-chain')
    ? container.snapshot.graph.getFunctionLevelAffectedTests(
      resolvedPath,
      changedFunctionImpactBase.changedFunctions,
      {
        symbolImpact: baseSymbolImpact,
        maxDepth: maxDepth ?? DEFAULTS.SYMBOL_IMPACT_DEPTH,
      }
    )
    : { functions: [], affectedTestsCount: 0 };
  const changedFunctionImpact = changedFunctionImpactBase
    ? { ...changedFunctionImpactBase, reuseHints, functionLevelAffectedTests }
    : null;
  const symbolImpact = baseSymbolImpact
    ? { ...baseSymbolImpact, changedFunctionImpact }
    : null;
  const affectedTests = graphKnown ? container.snapshot.graph.findAffectedTests(resolvedPath, maxDepth) : [];
  const history = resolvedPath ? await getFileHistoryRisk(container.workspaceRoot, resolvedPath, { limit: DEFAULTS.HISTORY_LIMIT }) : { ok: false };
  const historyRisk = history.ok ? history.historyRisk : null;
  const impactExplanations = graphKnown
    ? buildImpactExplanations({ file: relativeFile, impact })
    : [];
  const frameworkPattern = container.snapshot.graph.getFrameworkHint(resolvedPath);
  const baseEntry = {
    file: relativeFile,
    resolvedPath,
    classification,
    graphKnown,
    frameworkPattern,
    impactCount: impact.length,
    impact,
    changedLineRanges,
    symbolImpact,
    affectedTestsCount: affectedTests.length,
    affectedTests,
    historyRisk,
    recentCommits: history.ok ? history.recentCommits : [],
    impactExplanations,
  };
  const compositeRisk = buildCompositeRisk(baseEntry);

  return {
    ...baseEntry,
    compositeRisk,
  };
}

function buildDiffResult(safeEntries, finalEntries, changeMetrics, parsed, container) {
  const { detectStack } = require('../utils/stack-detectors/detect');
  const stack = detectStack(container.workspaceRoot);
  const result = {
    ok: true,
    workspaceRoot: container.workspaceRoot,
    scope: container.snapshot.graph.getScopeSummary(),
    summary: buildAuditDiffSummary(finalEntries, changeMetrics, stack.profile),
    validationAdvice: buildValidationAdvice(finalEntries, container.workspaceRoot),
    options: {
      reuseHints: parsed.reuseHints,
    },
    changedFiles: finalEntries,
  };
  if (parsed.incremental) {
    const { buildIncrementalFindings } = require('./incremental-diff');
    const changedPaths = safeEntries.map((e) => e.resolvedPath).filter(Boolean);
    result.incremental = true;
    result.incrementalFindings = buildIncrementalFindings(changedPaths, container);
  }
  if (parsed.withImpact) {
    const impactFiles = new Set();
    for (const entry of safeEntries) {
      if (!entry.resolvedPath) continue;
      try {
        const impact = container.snapshot.graph.getImpactRadius(entry.resolvedPath, 2);
        for (const i of impact) {
          if (i.file && i.file !== entry.resolvedPath) {
            impactFiles.add(i.file);
          }
        }
      } catch (err) {
        if (process.env.DEBUG) {
          console.error(`[CLI] Impact calculation failed for ${entry.resolvedPath}:`, err.message);
        }
      }
    }
    result.impactFiles = Array.from(impactFiles);
  }

  // Calculate hasFindings O(1) return contract
  result.hasFindings = result.summary?.counts?.highCompositeRiskFiles > 0 || result.summary?.counts?.affectedTests > 0;

  return result;
}

async function assembleDiff(parsed, container) {
  const since = parsed.since || null;
  const commits = parsed.commits || null;
  const staged = parsed.staged === true;
  const explicitFiles = parsed.files ? parsed.files.split(',').map((f) => f.trim()).filter(Boolean) : null;

  let changed;
  if (explicitFiles) {
    changed = { ok: true, workspaceRoot: container.workspaceRoot, changedFiles: explicitFiles };
  } else {
    changed = await getChangedFiles(container.workspaceRoot, { staged, includeUntracked: !staged, since, commits });
    if (changed.ok === false) {
      return changed;
    }
  }

  const numstat = explicitFiles
    ? { ok: false }
    : await getDiffNumstat(container.workspaceRoot, { staged, includeUntracked: !staged, since, commits });
  const changeMetrics = buildChangeMetrics(numstat, changed);

  const entries = await mapWithConcurrency(changed.changedFiles, DEFAULTS.CLI_CONCURRENCY, (relativeFile) =>
    buildDiffEntry(relativeFile, container, parsed)
  );
  const safeEntries = entries.map((entry, index) => {
    if (!entry?.__error) return entry;
    const baseEntry = {
      file: changed.changedFiles[index],
      resolvedPath: null,
      classification: null,
      graphKnown: false,
      frameworkPattern: null,
      impactCount: 0,
      impact: [],
      changedLineRanges: [],
      symbolImpact: null,
      affectedTestsCount: 0,
      affectedTests: [],
      historyRisk: null,
      recentCommits: [],
      processingError: entry.__error,
    };
    return {
      ...baseEntry,
      compositeRisk: buildCompositeRisk(baseEntry),
    };
  });

  const shouldAutoCompact = !parsed.compact && safeEntries.length > DEFAULTS.AUDIT_DIFF_AUTO_COMPACT_THRESHOLD;
  const finalEntries = (parsed.compact || shouldAutoCompact)
    ? safeEntries.map((entry) => compactChangedFile(entry))
    : safeEntries;

  return buildDiffResult(safeEntries, finalEntries, changeMetrics, parsed, container);
}

async function assembleFile(parsed, container) {
  const resolvedPath = resolveWorkspaceFilePath(parsed.file, container.workspaceRoot);
  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    return { ok: false, error: `File not found: ${parsed.file}`, inProject: false, hasFindings: false };
  }
  // Honor --depth parameter (surface | detail | full)
  const maxDepth = parsed.depth === 'surface' ? 1 : parsed.depth === 'detail' ? DEFAULTS.SYMBOL_IMPACT_DEPTH : undefined;
  const actualMaxDepth = parsed.maxDepth ?? maxDepth;

  const [impact, affectedTests] = await Promise.all([
    dependencyGraph({ cwd: parsed.cwd, operation: 'impact', file: parsed.file }, container),
    dependencyGraph({
      cwd: parsed.cwd,
      operation: 'affected_tests',
      file: parsed.file,
      maxDepth: actualMaxDepth,
    }, container),
  ]);
  const frameworkPattern = container.snapshot.graph.getFrameworkHint(resolvedPath);
  const validationAdvice = buildFileValidationAdvice(resolvedPath, container.workspaceRoot);
  const result = {
    ok: impact.ok !== false && affectedTests.ok !== false,
    workspaceRoot: container.workspaceRoot,
    file: parsed._rawFile || parsed.file,
    resolvedPath: impact.resolvedPath || affectedTests.resolvedPath || null,
    summary: buildFileSummary(impact, affectedTests),
    frameworkPattern,
    validationAdvice,
    impact,
    affectedTests,
  };

  // Calculate hasFindings O(1) return contract
  result.hasFindings = (result.impact?.impactCount || 0) > 0 || (result.affectedTests?.affectedTestsCount || 0) > 0;

  return result;
}

async function assembleSecurity(parsed, container) {
  const explicitSecFiles = parsed.files ? parsed.files.split(',').map((f) => f.trim()).filter(Boolean) : null;
  const secResult = await auditSecurity({
    cwd: parsed.cwd,
    targets: explicitSecFiles || parsed.targets,
    config: parsed.config,
    language: parsed.language,
    builtinOnly: parsed.builtinOnly,
  }, container);

  if (parsed.severity && secResult.findings) {
    secResult.findings = secResult.findings.filter((f) => severityMeetsFilter(f.severity, parsed.severity));
    secResult.summary.total = secResult.findings.length;
    secResult.summary.bySeverity = groupBySeverity(secResult.findings);
  }

  // Calculate hasFindings O(1) return contract
  secResult.hasFindings = (secResult.summary?.total || 0) > 0;

  return secResult;
}

module.exports = {
  assembleSummary,
  assembleDiff,
  assembleFile,
  assembleSecurity,
};
