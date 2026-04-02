const path = require('path');

function toSymbolSet(symbols) {
  if (!Array.isArray(symbols) || symbols.length === 0) return null;
  return new Set(symbols.filter(Boolean));
}

function symbolSetToArray(symbolSet) {
  if (symbolSet === null) return [];
  return Array.from(symbolSet);
}

function getMatchingImportRecords(depGraph, importerFile, importedFile) {
  const importerInfo = depGraph.graph.get(importerFile);
  if (!importerInfo?.importRecords) return [];
  return importerInfo.importRecords.filter((record) => record.resolved === importedFile);
}

function collectDirectSymbolUsage(depGraph, sourceFile, importerFile, sourceSymbols) {
  const records = getMatchingImportRecords(depGraph, importerFile, sourceFile);
  if (records.length === 0) {
    return { mode: 'unknown', symbols: [] };
  }

  let usesAllExports = false;
  const importedSymbols = new Set();
  for (const record of records) {
    if (record.usesAllExports) {
      usesAllExports = true;
    }
    for (const importedName of record.imported || []) {
      importedSymbols.add(importedName);
    }
  }

  if (usesAllExports) {
    return {
      mode: 'all-exports',
      symbols: sourceSymbols || [],
    };
  }

  const incoming = toSymbolSet(sourceSymbols);
  if (incoming === null) {
    return {
      mode: importedSymbols.size > 0 ? 'named' : 'unknown',
      symbols: Array.from(importedSymbols),
    };
  }

  const matched = Array.from(importedSymbols).filter((name) => incoming.has(name));
  if (matched.length > 0) {
    return { mode: 'named', symbols: matched };
  }
  return { mode: 'none', symbols: [] };
}

function collectReExportedSymbols(depGraph, sourceFile, reExporterFile, sourceSymbols) {
  const records = getMatchingImportRecords(depGraph, reExporterFile, sourceFile);
  if (records.length === 0) {
    return null;
  }

  const incoming = toSymbolSet(sourceSymbols);
  let propagatedAll = false;
  const propagated = new Set();

  for (const record of records) {
    if (record.reExportAll) {
      propagatedAll = true;
    }

    for (const pair of record.reExported || []) {
      if (incoming === null || incoming.has(pair.imported)) {
        propagated.add(pair.exported);
      }
    }
  }

  if (propagatedAll) {
    return incoming;
  }

  if (propagated.size === 0) {
    return null;
  }

  return propagated;
}

function shouldFallbackToFileImpact(depGraph, filePath) {
  const info = depGraph.graph.get(filePath);
  if (!info) return true;
  const ext = path.extname(filePath).toLowerCase();
  if (['.js', '.jsx', '.ts', '.tsx'].includes(ext)) {
    return info.parseMode !== 'ast';
  }
  if (ext === '.py') {
    return info.parseMode !== 'ast';
  }
  return false;
}

function buildSymbolToDependents(depGraph, filePath, sourceSymbols) {
  if (!Array.isArray(sourceSymbols) || sourceSymbols.length === 0) return [];
  const rows = [];

  for (const symbol of sourceSymbols) {
    const files = [];
    for (const importerFile of depGraph.getDependents(filePath)) {
      const records = getMatchingImportRecords(depGraph, importerFile, filePath);
      if (records.length === 0) continue;
      const used = records.some((record) => {
        if (record.usesAllExports) return true;
        return (record.imported || []).includes(symbol);
      });
      if (used) files.push(importerFile);
    }
    rows.push({
      symbol,
      dependentCount: files.length,
      dependents: files,
    });
  }

  return rows.sort((a, b) => b.dependentCount - a.dependentCount);
}

function buildFunctionToDependents(sourceInfo, symbolToDependents) {
  const exportRecords = Array.isArray(sourceInfo?.exportRecords) ? sourceInfo.exportRecords : [];
  const functionNames = Array.from(new Set(
    exportRecords
      .filter((record) => String(record?.kind || '').startsWith('function'))
      .map((record) => record.name)
      .filter((name) => name && name !== 'default')
  ));
  if (functionNames.length === 0) return [];

  const rowsBySymbol = new Map((symbolToDependents || []).map((row) => [row.symbol, row]));
  return functionNames.map((name) => {
    const row = rowsBySymbol.get(name);
    if (!row) {
      return { function: name, dependentCount: 0, dependents: [] };
    }
    return {
      function: name,
      dependentCount: row.dependentCount,
      dependents: row.dependents,
    };
  }).sort((a, b) => b.dependentCount - a.dependentCount);
}

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

  const symbolImpact = options.symbolImpact || getSymbolImpact(depGraph, filePath, options.maxDepth || 4);
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

function tokenDiceSimilarity(aName, bName) {
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

function getFunctionReuseHints(depGraph, filePath, changedFunctions, options = {}) {
  const list = Array.isArray(changedFunctions) ? changedFunctions : [];
  if (list.length === 0) return [];
  const minScore = Number.isFinite(options.minScore) ? options.minScore : 0.5;
  const maxPerFunction = Number.isFinite(options.maxPerFunction) ? options.maxPerFunction : 3;
  const hints = [];

  for (const fnName of list) {
    const candidates = [];
    for (const [candidateFile, info] of depGraph.graph || []) {
      if (candidateFile === filePath) continue;
      const records = Array.isArray(info?.exportRecords) ? info.exportRecords : [];
      for (const record of records) {
        if (!String(record?.kind || '').startsWith('function')) continue;
        if (!record?.name || record.name === 'default') continue;
        const score = tokenDiceSimilarity(fnName, record.name);
        if (score < minScore) continue;
        candidates.push({
          file: candidateFile,
          function: record.name,
          score: Math.round(score * 100) / 100,
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

function getSymbolImpact(depGraph, filePath, maxDepth = 4) {
  const sourceInfo = depGraph.graph.get(filePath);
  if (!sourceInfo) {
    return {
      mode: 'file-fallback',
      reason: 'source-not-indexed',
      impactedFiles: depGraph.getImpactRadius(filePath, maxDepth),
    };
  }

  if (shouldFallbackToFileImpact(depGraph, filePath)) {
    return {
      mode: 'file-fallback',
      reason: 'ast-unavailable',
      impactedFiles: depGraph.getImpactRadius(filePath, maxDepth),
    };
  }

  const sourceSymbols = sourceInfo.exports || [];
  const symbolToDependents = buildSymbolToDependents(depGraph, filePath, sourceSymbols);
  const functionToDependents = buildFunctionToDependents(sourceInfo, symbolToDependents);
  const direct = [];
  const reExportQueue = [];
  const seenReExportNode = new Set();

  for (const importerFile of depGraph.getDependents(filePath)) {
    const usage = collectDirectSymbolUsage(depGraph, filePath, importerFile, sourceSymbols);
    if (usage.mode !== 'none') {
      direct.push({
        file: importerFile,
        mode: usage.mode,
        symbols: usage.symbols,
      });
    }

    const reExportedSymbols = collectReExportedSymbols(depGraph, filePath, importerFile, sourceSymbols);
    if (reExportedSymbols) {
      reExportQueue.push({
        file: importerFile,
        level: 1,
        symbols: reExportedSymbols,
        via: [filePath],
      });
    }
  }

  const transitive = [];
  while (reExportQueue.length > 0) {
    const current = reExportQueue.shift();
    const queueKey = `${current.file}::${symbolSetToArray(current.symbols).sort().join(',')}`;
    if (seenReExportNode.has(queueKey)) continue;
    seenReExportNode.add(queueKey);

    transitive.push({
      file: current.file,
      level: current.level,
      symbols: symbolSetToArray(current.symbols),
      via: current.via,
    });

    if (current.level >= maxDepth) continue;

    for (const importerFile of depGraph.getDependents(current.file)) {
      const usage = collectDirectSymbolUsage(
        depGraph,
        current.file,
        importerFile,
        symbolSetToArray(current.symbols)
      );
      if (usage.mode !== 'none') {
        direct.push({
          file: importerFile,
          mode: usage.mode,
          symbols: usage.symbols,
        });
      }

      const nextReExported = collectReExportedSymbols(
        depGraph,
        current.file,
        importerFile,
        symbolSetToArray(current.symbols)
      );
      if (!nextReExported) continue;
      reExportQueue.push({
        file: importerFile,
        level: current.level + 1,
        symbols: nextReExported,
        via: [...current.via, current.file],
      });
    }
  }

  const uniqueDirect = [];
  const seenDirect = new Set();
  for (const item of direct) {
    const key = `${item.file}|${item.mode}|${(item.symbols || []).slice().sort().join(',')}`;
    if (seenDirect.has(key)) continue;
    seenDirect.add(key);
    uniqueDirect.push(item);
  }

  return {
    mode: 'symbol',
    sourceFile: filePath,
    sourceSymbols,
    symbolToDependents,
    functionToDependents,
    directCount: uniqueDirect.length,
    directDependents: uniqueDirect,
    transitiveCount: transitive.length,
    transitiveDependents: transitive,
  };
}

module.exports = {
  getSymbolImpact,
  getChangedFunctionImpact,
  getFunctionReuseHints,
};
