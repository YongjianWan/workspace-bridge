const path = require('path');
const {
  getChangedFunctionImpact,
  getFunctionReuseHints,
  getFunctionLevelAffectedTests,
} = require('./function-impact');

function toSymbolSet(symbols) {
  if (!Array.isArray(symbols) || symbols.length === 0) return null;
  return new Set(symbols.filter(Boolean));
}

function symbolSetToArray(symbolSet) {
  if (symbolSet === null) return [];
  return Array.from(symbolSet);
}

function getMatchingImportRecords(depGraph, importerFile, importedFile) {
  const importerInfo = depGraph.getFileInfo(importerFile);
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
  const info = depGraph.getFileInfo(filePath);
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

function getSymbolImpact(depGraph, filePath, maxDepth = 4) {
  const sourceFile = depGraph.normalizeFilePath(filePath);
  const sourceInfo = depGraph.getFileInfo(sourceFile);
  if (!sourceInfo) {
    return {
      mode: 'file-fallback',
      reason: 'source-not-indexed',
      impactedFiles: depGraph.getImpactRadius(sourceFile, maxDepth),
      sourceSymbols: [],
      symbolToDependents: [],
      functionToDependents: [],
      directCount: 0,
      directDependents: [],
      transitiveCount: 0,
      transitiveDependents: [],
    };
  }

  if (shouldFallbackToFileImpact(depGraph, sourceFile)) {
    return {
      mode: 'file-fallback',
      reason: 'ast-unavailable',
      impactedFiles: depGraph.getImpactRadius(sourceFile, maxDepth),
      sourceSymbols: sourceInfo.exports || [],
      symbolToDependents: [],
      functionToDependents: [],
      directCount: 0,
      directDependents: [],
      transitiveCount: 0,
      transitiveDependents: [],
    };
  }

  const sourceSymbols = sourceInfo.exports || [];
  const symbolToDependents = buildSymbolToDependents(depGraph, sourceFile, sourceSymbols);
  const functionToDependents = buildFunctionToDependents(sourceInfo, symbolToDependents);
  const direct = [];
  const reExportQueue = [];
  const seenReExportNode = new Set();

  for (const importerFile of depGraph.getDependents(sourceFile)) {
    const usage = collectDirectSymbolUsage(depGraph, sourceFile, importerFile, sourceSymbols);
    if (usage.mode !== 'none') {
      direct.push({
        file: importerFile,
        mode: usage.mode,
        symbols: usage.symbols,
      });
    }

    const reExportedSymbols = collectReExportedSymbols(depGraph, sourceFile, importerFile, sourceSymbols);
    if (reExportedSymbols) {
      reExportQueue.push({
        file: importerFile,
        level: 1,
        symbols: reExportedSymbols,
        via: [sourceFile],
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
    sourceFile,
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
  getFunctionLevelAffectedTests,
};
