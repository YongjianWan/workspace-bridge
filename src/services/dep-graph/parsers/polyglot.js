const { uniqueNames, createExportRecord, createImportRecord } = require('./shared');

function parseKotlin(content) {
  const imports = [];
  const importRecords = [];
  const exportRecords = [];

  const importRegex = /^\s*import\s+([\w.]+)(?:\.\*)?\s*(?:as\s+\w+)?/gm;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const source = match[1] + (match[0].includes('.*') ? '.*' : '');
    const isWildcard = source.endsWith('.*');
    imports.push(source);
    importRecords.push(createImportRecord(source, {
      imported: isWildcard ? [] : [source.split('.').pop()],
      usesAllExports: isWildcard,
    }));
  }

  const exportRegex = /\b(?:public\s+)?(?:abstract\s+|open\s+|data\s+)?(?:class|interface|object|enum)\s+([A-Za-z_]\w*)/g;
  while ((match = exportRegex.exec(content)) !== null) {
    exportRecords.push(createExportRecord(match[1], { kind: 'class' }));
  }

  const funRegex = /\bfun\s+([A-Za-z_]\w*)\s*\(/g;
  while ((match = funRegex.exec(content)) !== null) {
    exportRecords.push(createExportRecord(match[1], { kind: 'function' }));
  }

  return {
    imports: uniqueNames(imports),
    exports: uniqueNames(exportRecords.map((r) => r.name)),
    importRecords,
    exportRecords,
    parseMode: 'regex',
  };
}

function parseGo(content) {
  const imports = [];
  const importRecords = [];
  const exportRecords = [];

  const singleImport = /^\s*import\s+"([^"]+)"/gm;
  let match;
  while ((match = singleImport.exec(content)) !== null) {
    imports.push(match[1]);
    importRecords.push(createImportRecord(match[1], { usesAllExports: true }));
  }

  const blockImport = /^\s*import\s+\(([\s\S]*?)\)/m;
  const blockMatch = content.match(blockImport);
  if (blockMatch) {
    const inner = blockMatch[1];
    const innerRegex = /"([^"]+)"/g;
    while ((match = innerRegex.exec(inner)) !== null) {
      imports.push(match[1]);
      importRecords.push(createImportRecord(match[1], { usesAllExports: true }));
    }
  }

  const typeRegex = /\btype\s+([A-Z]\w*)/g;
  while ((match = typeRegex.exec(content)) !== null) {
    exportRecords.push(createExportRecord(match[1], { kind: 'type' }));
  }
  const funcRegex = /\bfunc\s+(?:\([^)]*\)\s+)?([A-Z]\w*)\s*\(/g;
  while ((match = funcRegex.exec(content)) !== null) {
    exportRecords.push(createExportRecord(match[1], { kind: 'function' }));
  }

  return {
    imports: uniqueNames(imports),
    exports: uniqueNames(exportRecords.map((r) => r.name)),
    importRecords,
    exportRecords,
    parseMode: 'regex',
  };
}

function parseRust(content) {
  const imports = [];
  const importRecords = [];
  const exportRecords = [];

  const useRegex = /^\s*use\s+([\w:]+)\s*;/gm;
  let match;
  while ((match = useRegex.exec(content)) !== null) {
    imports.push(match[1]);
    importRecords.push(createImportRecord(match[1], { usesAllExports: match[1].endsWith('::*') }));
  }

  const fnRegex = /\bpub\s+(?:async\s+)?fn\s+(\w+)/g;
  while ((match = fnRegex.exec(content)) !== null) {
    exportRecords.push(createExportRecord(match[1], { kind: 'function' }));
  }
  const structRegex = /\bpub\s+struct\s+(\w+)/g;
  while ((match = structRegex.exec(content)) !== null) {
    exportRecords.push(createExportRecord(match[1], { kind: 'struct' }));
  }

  return {
    imports: uniqueNames(imports),
    exports: uniqueNames(exportRecords.map((r) => r.name)),
    importRecords,
    exportRecords,
    parseMode: 'regex',
  };
}

module.exports = { parseKotlin, parseGo, parseRust };
