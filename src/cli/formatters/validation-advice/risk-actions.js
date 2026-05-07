/**
 * Top-risk action builder: per-file actionable advice for high composite-risk entries.
 */
function pickSuggestedCommand(allCommands) {
  const names = ['focused-tests', 'all-tests', 'type-check', 'lint'];
  for (const key of names) {
    const hit = allCommands.find((cmd) => String(cmd.name || '').includes(key));
    if (hit?.cmd) return hit.cmd;
  }
  return allCommands[0]?.cmd || null;
}

function buildTopRiskActions(entries, allCommands) {
  return entries
    .filter((entry) => entry?.compositeRisk)
    .sort((a, b) => (b.compositeRisk.score || 0) - (a.compositeRisk.score || 0))
    .slice(0, 3)
    .map((entry) => {
      const actions = [];
      if (entry.affectedTestCount > 0) {
        actions.push(`Run mapped tests first (${entry.affectedTestCount}).`);
      } else if (entry.impactCount > 0) {
        actions.push(`No mapped tests; inspect dependents (${entry.impactCount}) and add focused checks.`);
      } else {
        actions.push('No structural impact detected; run smoke checks and review recent history.');
      }
      if (entry.historyRisk?.level === 'high') {
        actions.push('Read last 3 commits for context before editing.');
      }
      if (entry.symbolImpact?.mode === 'file-fallback') {
        actions.push('Symbol analysis fell back to file-level; manually verify exported symbol usage.');
      }
      return {
        file: entry.file,
        score: entry.compositeRisk.score,
        level: entry.compositeRisk.level,
        suggestedCommand: pickSuggestedCommand(allCommands),
        actions,
        evidence: {
          impactCount: entry.impactCount || 0,
          affectedTestCount: entry.affectedTestCount || 0,
          historyRiskLevel: entry.historyRisk?.level || 'low',
          historySignals: (entry.historyRisk?.signals || []).slice(0, 2),
          symbolMode: entry.symbolImpact?.mode || 'unknown',
          topImpactedSymbols: (entry.symbolImpact?.symbolToDependents || [])
            .slice(0, 3)
            .map((item) => ({ symbol: item.symbol, dependentCount: item.dependentCount })),
        },
      };
    });
}

module.exports = { pickSuggestedCommand, buildTopRiskActions };
