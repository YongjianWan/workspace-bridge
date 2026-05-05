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

function findFunctionsOverlappingRanges(records, ranges) {
  return Array.from(new Set(
    records
      .filter((record) => String(record?.kind || '').startsWith('function'))
      .filter((record) => record?.name && record.name !== 'default')
      .filter((record) => Number.isFinite(record.lineStart) && Number.isFinite(record.lineEnd))
      .filter((record) =>
        ranges.some((range) => rangesOverlap(range.startLine, range.endLine, record.lineStart, record.lineEnd))
      )
      .map((record) => record.name)
  ));
}

function findExportingCallers(changedInternalFunctions, exportRecords, functionRecords) {
  const exportingCallers = new Set();
  if (changedInternalFunctions.length === 0) return exportingCallers;

  const exportNames = new Set(exportRecords.map((r) => r.name));
  const byName = new Map();
  for (const record of functionRecords) {
    if (record?.name) byName.set(record.name, record);
  }

  const visited = new Set();
  function dfs(calleeName) {
    if (visited.has(calleeName)) return;
    visited.add(calleeName);
    for (const [callerName, record] of byName) {
      if (callerName === calleeName) continue;
      const callCallees = record.fingerprint?.callCallees || [];
      if (callCallees.includes(calleeName)) {
        if (exportNames.has(callerName)) {
          exportingCallers.add(callerName);
        } else {
          dfs(callerName);
        }
      }
    }
  }

  for (const fn of changedInternalFunctions) {
    dfs(fn);
  }

  return exportingCallers;
}

function buildImpactedFunctionDependents(changedFunctions, symbolImpact) {
  const functionRows = Array.isArray(symbolImpact?.functionToDependents) ? symbolImpact.functionToDependents : [];
  const impactedFunctionDependents = functionRows
    .filter((row) => changedFunctions.includes(row.function))
    .sort((a, b) => (b.dependentCount || 0) - (a.dependentCount || 0));

  const impactedDependentCount = impactedFunctionDependents.reduce(
    (sum, row) => sum + (Number.isFinite(row.dependentCount) ? row.dependentCount : 0),
    0
  );

  return { impactedFunctionDependents, impactedDependentCount };
}

function getChangedFunctionImpact(depGraph, filePath, lineRanges, options = {}) {
  const sourceFile = depGraph.normalizeFilePath(filePath);
  const ranges = normalizeLineRanges(lineRanges);
  const sourceInfo = depGraph.getFileInfo(sourceFile);
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

  const ext = path.extname(sourceFile).toLowerCase();
  if (!['.js', '.jsx', '.ts', '.tsx', '.go'].includes(ext) || sourceInfo.parseMode !== 'ast') {
    return {
      mode: 'unavailable',
      reason: 'ast-unavailable-or-unsupported-language',
      actualParseMode: sourceInfo.parseMode,
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

  const changedFunctions = findFunctionsOverlappingRanges(
    Array.isArray(sourceInfo.exportRecords) ? sourceInfo.exportRecords : [],
    ranges
  );

  if (changedFunctions.length === 0) {
    // Trace internal function call chains to find exporting callers
    const exportRecords = Array.isArray(sourceInfo.exportRecords) ? sourceInfo.exportRecords : [];
    const functionRecords = Array.isArray(sourceInfo.functionRecords) ? sourceInfo.functionRecords : [];
    const changedInternalFunctions = findFunctionsOverlappingRanges(functionRecords, ranges);
    const exportingCallers = findExportingCallers(changedInternalFunctions, exportRecords, functionRecords);

    if (exportingCallers.size > 0) {
      const via = Array.from(exportingCallers);
      const { impactedFunctionDependents, impactedDependentCount } = buildImpactedFunctionDependents(via, options.symbolImpact);

      return {
        mode: 'internal-function-call-chain',
        changedFunctions: via,
        impactedFunctionDependents,
        impactedDependentCount,
        lineRanges: ranges,
      };
    }

    return {
      mode: 'no-exported-function-change',
      reason: 'changed-lines-not-in-exported-functions',
      changedFunctions: [],
      impactedFunctionDependents: [],
      impactedDependentCount: 0,
      lineRanges: ranges,
    };
  }

  const { impactedFunctionDependents, impactedDependentCount } = buildImpactedFunctionDependents(changedFunctions, options.symbolImpact);

  return {
    mode: 'function-symbol',
    changedFunctions,
    impactedFunctionDependents,
    impactedDependentCount,
    lineRanges: ranges,
  };
}

function getFunctionReuseHints(depGraph, filePath, changedFunctions, options = {}) {
  const sourceFile = depGraph.normalizeFilePath(filePath);
  const list = Array.isArray(changedFunctions) ? Array.from(new Set(changedFunctions)) : [];
  if (list.length === 0) return [];
  const minScore = Number.isFinite(options.minScore) ? options.minScore : 0.5;
  const maxPerFunction = Number.isFinite(options.maxPerFunction) ? options.maxPerFunction : 3;
  const sourceInfo = depGraph.getFileInfo(sourceFile) || {};
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
    for (const [candidateFile, info] of depGraph.getAllFileInfos()) {
      if (candidateFile === sourceFile) continue;
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

function mergeTestRow(map, testFile, distance, via, source = 'function-level') {
  const existing = map.get(testFile);
  if (!existing || distance < existing.distance) {
    map.set(testFile, { file: testFile, distance, source, via: via || [] });
  }
}

function getFunctionLevelAffectedTests(depGraph, filePath, changedFunctions, options = {}) {
  const sourceFile = depGraph.normalizeFilePath(filePath);
  const list = Array.isArray(changedFunctions) ? Array.from(new Set(changedFunctions)) : [];
  const { DEFAULTS } = require('../../config/constants');

  const maxDepth = Number.isFinite(options.maxDepth) ? Math.max(1, options.maxDepth) : DEFAULTS.SYMBOL_IMPACT_DEPTH;
  const symbolImpact = options.symbolImpact || null;
  const functionRows = Array.isArray(symbolImpact?.functionToDependents) ? symbolImpact.functionToDependents : [];
  const byFunction = new Map(functionRows.map((row) => [row.function, row]));

  const functionLevelAffectedTests = [];
  const totalUniqueTests = new Set();
  const dependentBfsCache = new Map();

  for (const fnName of list) {
    const row = byFunction.get(fnName);
    const dependents = Array.isArray(row?.dependents) ? row.dependents : [];
    const testMap = new Map();

    for (const dependentFile of dependents) {
      if (depGraph.isTestLikeFile(dependentFile)) {
        mergeTestRow(testMap, dependentFile, 1, [`${sourceFile}#${fnName}`, dependentFile], 'function-level');
        continue;
      }

      let affected = dependentBfsCache.get(dependentFile);
      if (!affected) {
        affected = depGraph.findAffectedTests(dependentFile, maxDepth, { includeHeuristic: false });
        dependentBfsCache.set(dependentFile, affected);
      }
      for (const test of affected) {
        const distance = Number.isFinite(test?.distance) ? test.distance + 1 : maxDepth + 1;
        mergeTestRow(testMap, test.file, distance, [`${sourceFile}#${fnName}`, dependentFile, ...(test.via || [])], 'function-level');
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
