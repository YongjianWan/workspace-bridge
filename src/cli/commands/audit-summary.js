const fs = require('fs');
const path = require('path');
const { projectHealth } = require('../../tools/health-tools');
const { dependencyGraph } = require('../../tools/dep-tools');
const { buildRepoSummary } = require('../../cli/formatters');
const { severityMeetsFilter } = require('./_utils');

async function auditSummaryCmd(parsed, container) {
  const regressionTools = require('../../tools/regression-tools');
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
  const scope = container.depGraph.getScopeSummary();
  const { detectStack } = require('../../utils/stack-detectors/detect');
  const stack = detectStack(container.workspaceRoot);
  const stats = container.depGraph.getStats();
  // L1-3: analysisCoverage must reflect the filtered file set (same as scope)
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
    const savePath = path.resolve(parsed.cwd || process.cwd(), parsed.save);
    regressionTools.saveBaseline(result, savePath);
    result.baselineSaved = savePath;
  }
  if (parsed.checkRegression) {
    let baselinePath = null;
    let commitBaseline = null;
    if (parsed.baseline) {
      const resolved = path.resolve(parsed.cwd || process.cwd(), parsed.baseline);
      if (fs.existsSync(resolved)) {
        baselinePath = resolved;
      } else {
        commitBaseline = parsed.baseline;
      }
    }
    if (commitBaseline) {
      result.regression = regressionTools.checkRegressionAgainstCommit(result, commitBaseline, parsed.cwd || process.cwd());
    } else {
      result.regression = regressionTools.checkRegression(result, baselinePath);
    }
  }
  return result;
}

module.exports = auditSummaryCmd;
