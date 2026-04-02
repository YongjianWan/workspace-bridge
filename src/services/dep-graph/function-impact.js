const path = require('path');
const { compareFunctionRecords } = require('./function-similarity');

function normalizeLineRanges(lineRanges) {
  if (!Array.isArray(lineRanges)) return [];
  return lineRanges
    .map((range) => ({
      startLine: Number.parseInt(range?.startLine, 10),
      endLine: Number.parseInt(range?.endLine, 10),
    }))
    .filter((range) => Number.isFinite(range.startLine) && Number.isFinite(range.endLine) && range.endLine >= range.startLine);
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart <= bEnd && bStart <= aEnd;
}

function getChangedFunctionImpact(depGraph, filePath, lineRanges, options = {}) {
  const ranges = normalizeLineRanges(lineRanges);
  const sourceInfo = depGraph.graph.get(filePath);
  if (!sourceInfo) {
    return {
      mode: 'unavailable',
      reason: 'source-not-indexed',
      changedFunctions: [],
      impactedFunctionDependents: [],
      impactedDependentCount: 0,
      lineRanges: ranges,
    };
  }

  const ext = path.extname(filePath).toLowerCase();
  if (!['.js', '.jsx', '.ts', '.tsx'].includes(ext) || sourceInfo.parseMode !== 'ast') {
    return {
      mode: 'unavailable',
      reason: 'ast-unavailable-or-unsupported-language',
      changedFunctions: [],
      impactedFunctionDependents: [],
      impactedDependentCount: 0,
      lineRanges: ranges,
    };
  }

  if (ranges.length === 0) {
    return {
      mode: 'no-diff-lines',
      reason: 'no-changed-line-ranges',
      changedFunctions: [],
      impactedFunctionDependents: [],
      impactedDependentCount: 0,
      lineRanges: [],
    };
  }

  const exportRecords = Array.isArray(sourceInfo.exportRecords) ? sourceInfo.exportRecords : [];
  const changedFunctions = Array.from(new Set(
    exportRecords
      .filter((record) => String(record?.kind || '').startsWith('function'))
      .filter((record) => record?.name && record.name !== 'default')
      .filter((record) => Number.isFinite(record.lineStart) && Number.isFinite(record.lineEnd))
      .filter((record) =>
        ranges.some((range) => rangesOverlap(range.startLine, range.endLine, record.lineStart, record.lineEnd))
      )
      .map((record) => record.name)
  ));

  const symbolImpact = options.symbolImpact || null;
  const functionRows = Array.isArray(symbolImpact?.functionToDependents) ? symbolImpact.functionToDependents : [];
  const impactedFunctionDependents = functionRows
    .filter((row) => changedFunctions.includes(row.function))
    .sort((a, b) => (b.dependentCount || 0) - (a.dependentCount || 0));

  const impactedDependentCount = impactedFunctionDependents.reduce(
    (sum, row) => sum + (Number.isFinite(row.dependentCount) ? row.dependentCount : 0),
    0
  );

  if (changedFunctions.length === 0) {
    return {
      mode: 'no-exported-function-change',
      reason: 'changed-lines-not-in-exported-functions',
      changedFunctions: [],
      impactedFunctionDependents: [],
      impactedDependentCount: 0,
      lineRanges: ranges,
    };
  }

  return {
    mode: 'function-symbol',
    changedFunctions,
    impactedFunctionDependents,
    impactedDependentCount,
    lineRanges: ranges,
  };
}

function getFunctionReuseHints(depGraph, filePath, changedFunctions, options = {}) {
  const list = Array.isArray(changedFunctions) ? changedFunctions : [];
  if (list.length === 0) return [];
  const minScore = Number.isFinite(options.minScore) ? options.minScore : 0.5;
  const maxPerFunction = Number.isFinite(options.maxPerFunction) ? options.maxPerFunction : 3;
  const sourceInfo = depGraph.graph.get(filePath) || {};
  const sourceRecords = Array.isArray(sourceInfo.exportRecords) ? sourceInfo.exportRecords : [];
  const sourceByName = new Map(
    sourceRecords
      .filter((record) => String(record?.kind || '').startsWith('function'))
      .map((record) => [record.name, record])
  );
  const hints = [];

  for (const fnName of list) {
    const candidates = [];
    const sourceRecord = sourceByName.get(fnName) || { name: fnName };
    for (const [candidateFile, info] of depGraph.graph || []) {
      if (candidateFile === filePath) continue;
      const records = Array.isArray(info?.exportRecords) ? info.exportRecords : [];
      for (const record of records) {
        if (!String(record?.kind || '').startsWith('function')) continue;
        if (!record?.name || record.name === 'default') continue;
        const similarity = compareFunctionRecords(sourceRecord, record);
        const score = similarity.score;
        if (score < minScore) continue;
        candidates.push({
          file: candidateFile,
          function: record.name,
          score: Math.round(score * 100) / 100,
          similarityMode: similarity.mode,
          structureScore: similarity.structureScore === null ? null : Math.round(similarity.structureScore * 100) / 100,
          nameScore: Math.round(similarity.nameScore * 100) / 100,
        });
      }
    }

    const top = candidates
      .sort((a, b) => b.score - a.score)
      .slice(0, maxPerFunction)
      .map((item) => ({
        file: path.relative(depGraph.root, item.file),
        function: item.function,
        score: item.score,
        similarityMode: item.similarityMode,
        structureScore: item.structureScore,
        nameScore: item.nameScore,
      }));

    if (top.length > 0) {
      hints.push({
        function: fnName,
        suggestions: top,
      });
    }
  }

  return hints;
}

function mergeTestRow(map, testFile, distance, via) {
  const existing = map.get(testFile);
  if (!existing || distance < existing.distance) {
    map.set(testFile, { file: testFile, distance, via: via || [] });
  }
}

function getFunctionLevelAffectedTests(depGraph, filePath, changedFunctions, options = {}) {
  const list = Array.isArray(changedFunctions) ? changedFunctions : [];
  const maxDepth = Number.isFinite(options.maxDepth) ? Math.max(1, options.maxDepth) : 4;
  const symbolImpact = options.symbolImpact || null;
  const functionRows = Array.isArray(symbolImpact?.functionToDependents) ? symbolImpact.functionToDependents : [];
  const byFunction = new Map(functionRows.map((row) => [row.function, row]));

  const functionLevelAffectedTests = [];
  const totalUniqueTests = new Set();

  for (const fnName of list) {
    const row = byFunction.get(fnName);
    const dependents = Array.isArray(row?.dependents) ? row.dependents : [];
    const testMap = new Map();

    for (const dependentFile of dependents) {
      if (depGraph.isTestLikeFile(dependentFile)) {
        mergeTestRow(testMap, dependentFile, 1, [`function:${fnName}`, dependentFile]);
        continue;
      }

      const affected = depGraph.findAffectedTests(dependentFile, maxDepth);
      for (const test of affected) {
        const distance = Number.isFinite(test?.distance) ? test.distance + 1 : maxDepth + 1;
        mergeTestRow(testMap, test.file, distance, [`function:${fnName}`, dependentFile, ...(test.via || [])]);
      }
    }

    const tests = Array.from(testMap.values()).sort((a, b) => {
      const dist = (a.distance || 0) - (b.distance || 0);
      return dist !== 0 ? dist : String(a.file).localeCompare(String(b.file));
    });
    for (const test of tests) totalUniqueTests.add(test.file);

    functionLevelAffectedTests.push({
      function: fnName,
      affectedTestCount: tests.length,
      affectedTests: tests,
    });
  }

  return {
    functions: functionLevelAffectedTests,
    affectedTestCount: totalUniqueTests.size,
  };
}

module.exports = {
  getChangedFunctionImpact,
  getFunctionReuseHints,
  getFunctionLevelAffectedTests,
};
