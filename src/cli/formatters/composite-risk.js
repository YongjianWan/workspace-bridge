const { scoreToLevel } = require('../../config/risk-thresholds');

function buildCompositeRisk(entry) {
  const reasons = [];
  let score = 0;

  const impactCount = entry?.impactCount || 0;
  const affectedTestCount = entry?.affectedTestCount || 0;
  const historyRiskScore = entry?.historyRisk?.score || 0;
  const symbolMode = entry?.symbolImpact?.mode || null;
  const changedFunctionImpact = entry?.symbolImpact?.changedFunctionImpact || null;
  const changedFunctions = Array.isArray(changedFunctionImpact?.changedFunctions)
    ? changedFunctionImpact.changedFunctions
    : [];

  if (impactCount >= 10) {
    score += 4;
    reasons.push(`Large impact radius (${impactCount} dependents).`);
  } else if (impactCount >= 5) {
    score += 3;
    reasons.push(`Broad impact radius (${impactCount} dependents).`);
  } else if (impactCount >= 2) {
    score += 1;
    reasons.push(`Has transitive impact (${impactCount} dependents).`);
  }

  if (affectedTestCount >= 3) {
    score += 2;
    reasons.push(`Many mapped tests affected (${affectedTestCount}).`);
  } else if (affectedTestCount >= 1) {
    score += 1;
    reasons.push(`Mapped tests affected (${affectedTestCount}).`);
  } else if (impactCount >= 3) {
    score += 1;
    reasons.push('No mapped tests despite structural impact.');
  }

  if (historyRiskScore >= 6) {
    score += 2;
    reasons.push(`History risk is high (${historyRiskScore}).`);
  } else if (historyRiskScore >= 3) {
    score += 1;
    reasons.push(`History risk is medium (${historyRiskScore}).`);
  }

  if (symbolMode === 'file-fallback') {
    score += 1;
    reasons.push('Symbol analysis fell back to file-level impact.');
  }

  if (changedFunctionImpact?.mode === 'function-symbol' && changedFunctions.length > 0) {
    score = Math.max(0, score - 1);
    reasons.push(`Function-scoped impact available (${changedFunctions.length} changed function(s)).`);

    const highImpactFunctions = (changedFunctionImpact.impactedFunctionDependents || [])
      .filter((row) => (row?.dependentCount || 0) >= 5);
    if (highImpactFunctions.length > 0) {
      score += Math.min(2, highImpactFunctions.length);
      reasons.push(`High-impact functions changed (${highImpactFunctions.map((row) => row.function).join(', ')}).`);
    }

    if (changedFunctions.length >= 3) {
      score += 1;
      reasons.push('Multiple functions changed; verify cross-cutting behavior.');
    }

    const functionLevelAffectedTests = changedFunctionImpact?.functionLevelAffectedTests?.affectedTestCount || 0;
    const impactedFunctionDependents = changedFunctionImpact?.impactedDependentCount || 0;
    if (impactedFunctionDependents >= 3 && functionLevelAffectedTests === 0) {
      score += 1;
      reasons.push('Changed functions affect dependents but no function-level tests were mapped.');
    }
  }

  if (entry?.classification?.isMainline === false && score > 0) {
    score -= 1;
    reasons.push('Non-mainline file: downgrade one point.');
  }

  score = Math.max(0, score);

  const level = scoreToLevel(score);

  if (reasons.length === 0) {
    reasons.push('Low observed structural and historical risk.');
  }

  return {
    level,
    score,
    reasons,
  };
}

module.exports = { buildCompositeRisk };
