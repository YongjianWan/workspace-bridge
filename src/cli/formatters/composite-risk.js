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

  // Structural impact: more dependents = higher risk.
  // Thresholds chosen to surface high-radius changes early without over-weighting small utilities.
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

  // Test coverage quality: many mapped tests lower risk; missing tests raise it.
  if (affectedTestCount >= 3) {
    score += 2;
    reasons.push(`Many mapped tests affected (${affectedTestCount}).`);
  } else if (affectedTestCount >= 1) {
    score += 1;
    reasons.push(`Mapped tests affected (${affectedTestCount}).`);
  } else if (impactCount >= 3) {
    // Structural impact with zero mapped tests is a coverage gap worth flagging.
    score += 1;
    reasons.push('No mapped tests despite structural impact.');
  }

  // History turbulence: files with many authors/commits are riskier to change.
  if (historyRiskScore >= 6) {
    score += 2;
    reasons.push(`History risk is high (${historyRiskScore}).`);
  } else if (historyRiskScore >= 3) {
    score += 1;
    reasons.push(`History risk is medium (${historyRiskScore}).`);
  }

  // Symbol-level precision gap: fallback means less confidence in impact boundaries.
  if (symbolMode === 'file-fallback') {
    score += 1;
    reasons.push('Symbol analysis fell back to file-level impact.');
  }

  if (changedFunctionImpact?.mode === 'function-symbol' && changedFunctions.length > 0) {
    // Function-scoped impact reduces uncertainty, so discount slightly.
    score = Math.max(0, score - 1);
    reasons.push(`Function-scoped impact available (${changedFunctions.length} changed function(s)).`);

    // Re-add risk if specific changed functions have high dependent counts.
    const highImpactFunctions = (changedFunctionImpact.impactedFunctionDependents || [])
      .filter((row) => (row?.dependentCount || 0) >= 5);
    if (highImpactFunctions.length > 0) {
      // Cap at +2 to avoid runaway scores for bulk refactors.
      score += Math.min(2, highImpactFunctions.length);
      reasons.push(`High-impact functions changed (${highImpactFunctions.map((row) => row.function).join(', ')}).`);
    }

    // Multiple function changes increase cross-cutting concern risk.
    if (changedFunctions.length >= 3) {
      score += 1;
      reasons.push('Multiple functions changed; verify cross-cutting behavior.');
    }

    const functionLevelAffectedTests = changedFunctionImpact?.functionLevelAffectedTests?.affectedTestCount || 0;
    const impactedFunctionDependents = changedFunctionImpact?.impactedDependentCount || 0;
    // Function-level dependents exist but no mapped tests → coverage gap at function granularity.
    if (impactedFunctionDependents >= 3 && functionLevelAffectedTests === 0) {
      score += 1;
      reasons.push('Changed functions affect dependents but no function-level tests were mapped.');
    }
  }

  // Downgrade non-mainline files because they usually have narrower production impact.
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
