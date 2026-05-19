const { dependencyGraph } = require('../../tools/dep-tools');
const {
  getChangedFiles,
  getChangedLineRanges,
  getFileHistoryRisk,
  getDiffNumstat,
} = require('../../tools/git-tools');
const { resolveWorkspaceFilePath } = require('../../utils/path');
const { buildAuditDiffSummary, buildValidationAdvice, buildImpactExplanations, compactChangedFile } = require('../../cli/formatters');
const { mapWithConcurrency } = require('../../utils/async');
const { DEFAULTS } = require('../../config/constants');

async function auditDiffCmd(parsed, container) {
  const since = parsed.since || null;
  const staged = parsed.staged === true;
  const explicitFiles = parsed.files ? parsed.files.split(',').map((f) => f.trim()).filter(Boolean) : null;

  let changed;
  if (explicitFiles) {
    changed = { ok: true, workspaceRoot: container.workspaceRoot, changedFiles: explicitFiles };
  } else {
    changed = await getChangedFiles(container.workspaceRoot, { staged, includeUntracked: !staged, since });
    if (changed.ok === false) {
      return changed;
    }
  }

  const numstat = explicitFiles
    ? { ok: false }
    : await getDiffNumstat(container.workspaceRoot, { staged, includeUntracked: !staged, since });
  const changeMetrics = numstat.ok ? {
    totalAdditions: numstat.totalAdditions,
    totalDeletions: numstat.totalDeletions,
    changedFileCount: numstat.files.length,
    untrackedFileCount: Math.max(0, changed.changedFiles.length - numstat.files.length),
  } : null;

  const entries = await mapWithConcurrency(changed.changedFiles, DEFAULTS.CLI_CONCURRENCY, async (relativeFile) => {
    const resolvedPath = resolveWorkspaceFilePath(relativeFile, container.workspaceRoot);
    const classification = container.projectContext?.classifyFile(resolvedPath) || null;
    const graphKnown = Boolean(resolvedPath && container.depGraph.hasFile(resolvedPath));
    const impact = graphKnown ? container.depGraph.getImpactRadius(resolvedPath) : [];
    let changedLineRanges = [];
    if (resolvedPath) {
      if (since) {
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
    const baseSymbolImpact = graphKnown ? container.depGraph.getSymbolImpact(resolvedPath) : null;
    const changedFunctionImpactBase = graphKnown
      ? container.depGraph.getChangedFunctionImpact(resolvedPath, changedLineRanges, { symbolImpact: baseSymbolImpact })
      : null;
    let reuseHints = [];
    if (parsed.reuseHints === 'on' && graphKnown && changedFunctionImpactBase?.mode === 'function-symbol') {
      try {
        reuseHints = container.depGraph.getFunctionReuseHints(resolvedPath, changedFunctionImpactBase.changedFunctions, {
          minScore: DEFAULTS.REUSE_HINTS_MIN_SCORE,
          maxPerFunction: DEFAULTS.REUSE_HINTS_MAX_PER_FUNCTION,
        });
      } catch (e) {
        // Non-core path: similarity hints should never block main diff analysis.
        if (!parsed.quiet) {
          console.error(`[warn] reuse hints failed for ${relativeFile}: ${e?.message || String(e)}`);
        }
        reuseHints = [];
      }
    }
    const functionLevelAffectedTests = graphKnown &&
      (changedFunctionImpactBase?.mode === 'function-symbol' || changedFunctionImpactBase?.mode === 'internal-function-call-chain')
      ? container.depGraph.getFunctionLevelAffectedTests(
        resolvedPath,
        changedFunctionImpactBase.changedFunctions,
        {
          symbolImpact: baseSymbolImpact,
          maxDepth: Number.isFinite(parsed.maxDepth) ? parsed.maxDepth : DEFAULTS.SYMBOL_IMPACT_DEPTH,
        }
      )
      : { functions: [], affectedTestsCount: 0 };
    const changedFunctionImpact = changedFunctionImpactBase
      ? { ...changedFunctionImpactBase, reuseHints, functionLevelAffectedTests }
      : null;
    const symbolImpact = baseSymbolImpact
      ? { ...baseSymbolImpact, changedFunctionImpact }
      : null;
    const affectedTests = graphKnown ? container.depGraph.findAffectedTests(resolvedPath, Number.isFinite(parsed.maxDepth) ? parsed.maxDepth : undefined) : [];
    const history = resolvedPath ? await getFileHistoryRisk(container.workspaceRoot, resolvedPath, { limit: DEFAULTS.HISTORY_LIMIT }) : { ok: false };
    const historyRisk = history.ok ? history.historyRisk : null;
    const impactExplanations = graphKnown
      ? buildImpactExplanations({ file: relativeFile, impact })
      : [];
    const frameworkPattern = container.depGraph.getFrameworkHint(resolvedPath);
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
    const { buildCompositeRisk } = require('../../cli/formatters');
    const compositeRisk = buildCompositeRisk(baseEntry);

    return {
      ...baseEntry,
      compositeRisk,
    };
  });
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
    const { buildCompositeRisk } = require('../../cli/formatters');
    return {
      ...baseEntry,
      compositeRisk: buildCompositeRisk(baseEntry),
    };
  });

  const shouldAutoCompact = !parsed.compact && safeEntries.length > DEFAULTS.AUDIT_DIFF_AUTO_COMPACT_THRESHOLD;
  const finalEntries = (parsed.compact || shouldAutoCompact)
    ? safeEntries.map((entry) => compactChangedFile(entry))
    : safeEntries;

  const { detectStack } = require('../../utils/stack-detectors/detect');
  const stack = detectStack(container.workspaceRoot);
  const result = {
    ok: true,
    workspaceRoot: container.workspaceRoot,
    scope: container.depGraph.getScopeSummary(),
    summary: buildAuditDiffSummary(finalEntries, changeMetrics, stack.profile),
    validationAdvice: buildValidationAdvice(finalEntries, container.workspaceRoot),
    options: {
      reuseHints: parsed.reuseHints,
    },
    changedFiles: finalEntries,
  };
  if (parsed.incremental) {
    const { buildIncrementalFindings } = require('../../tools/incremental-diff');
    const changedPaths = safeEntries.map((e) => e.resolvedPath).filter(Boolean);
    result.incremental = true;
    result.incrementalFindings = buildIncrementalFindings(changedPaths, container);
  }
  if (parsed.withImpact) {
    const impactFiles = new Set();
    for (const entry of safeEntries) {
      if (!entry.resolvedPath) continue;
      try {
        const impact = container.depGraph.getImpactRadius(entry.resolvedPath, 2);
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
  return result;
}

module.exports = auditDiffCmd;
