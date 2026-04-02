function normalizeFunctionName(name) {
  return String(name || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-]+/g, ' ')
    .toLowerCase()
    .trim();
}

function tokenizeFunctionName(name) {
  return normalizeFunctionName(name)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function diceSimilarityByTokens(aName, bName) {
  const aTokens = tokenizeFunctionName(aName);
  const bTokens = tokenizeFunctionName(bName);
  if (aTokens.length === 0 || bTokens.length === 0) return 0;
  const aSet = new Set(aTokens);
  const bSet = new Set(bTokens);
  let intersection = 0;
  for (const token of aSet) {
    if (bSet.has(token)) intersection += 1;
  }
  return (2 * intersection) / (aSet.size + bSet.size);
}

function jaccardSimilarity(aValues, bValues) {
  const aSet = new Set(Array.isArray(aValues) ? aValues : []);
  const bSet = new Set(Array.isArray(bValues) ? bValues : []);
  if (aSet.size === 0 && bSet.size === 0) return 1;
  if (aSet.size === 0 || bSet.size === 0) return 0;
  let intersection = 0;
  for (const value of aSet) {
    if (bSet.has(value)) intersection += 1;
  }
  return intersection / (aSet.size + bSet.size - intersection);
}

function numberSimilarity(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  if (a === 0 && b === 0) return 1;
  const high = Math.max(Math.abs(a), Math.abs(b), 1);
  const low = Math.min(Math.abs(a), Math.abs(b));
  return low / high;
}

function booleanSimilarity(a, b) {
  return Boolean(a) === Boolean(b) ? 1 : 0;
}

function structuralSimilarity(aFingerprint, bFingerprint) {
  if (!aFingerprint || !bFingerprint) return null;

  const parts = [
    { score: numberSimilarity(aFingerprint.paramCount, bFingerprint.paramCount), weight: 0.25 },
    { score: jaccardSimilarity(aFingerprint.callCallees, bFingerprint.callCallees), weight: 0.4 },
    {
      score: (
        booleanSimilarity(aFingerprint.isAsync, bFingerprint.isAsync) * 0.3 +
        booleanSimilarity(aFingerprint.isGenerator, bFingerprint.isGenerator) * 0.1 +
        booleanSimilarity(aFingerprint.hasTryCatch, bFingerprint.hasTryCatch) * 0.2 +
        numberSimilarity(aFingerprint.branchCount, bFingerprint.branchCount) * 0.2 +
        numberSimilarity(aFingerprint.returnCount, bFingerprint.returnCount) * 0.2
      ),
      weight: 0.35,
    },
  ];

  let weightedScore = 0;
  let totalWeight = 0;
  for (const part of parts) {
    weightedScore += part.score * part.weight;
    totalWeight += part.weight;
  }
  return totalWeight > 0 ? weightedScore / totalWeight : null;
}

function compareFunctionRecords(sourceRecord, candidateRecord) {
  const nameScore = diceSimilarityByTokens(sourceRecord?.name, candidateRecord?.name);
  const structureScore = structuralSimilarity(sourceRecord?.fingerprint, candidateRecord?.fingerprint);

  const score = structureScore === null
    ? nameScore
    : (structureScore * 0.75) + (nameScore * 0.25);

  return {
    score,
    nameScore,
    structureScore,
    mode: structureScore === null ? 'name-only' : 'structure+name',
  };
}

module.exports = {
  compareFunctionRecords,
};
