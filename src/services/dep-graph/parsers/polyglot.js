const { uniqueNames, createExportRecord, createImportRecord } = require('./shared');

function parseKotlin(content) {
  const imports = [];
  const importRecords = [];
  const exportRecords = [];
  const functionRecords = [];

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
    const lineStart = content.lastIndexOf('\n', match.index) + 1;
    const lineEnd = content.indexOf('\n', match.index);
    const line = content.slice(lineStart, lineEnd === -1 ? content.length : lineEnd);
    if (/\b(private|internal|protected)\b/.test(line)) continue;
    exportRecords.push(createExportRecord(match[1], { kind: 'function' }));
    functionRecords.push({
      name: match[1],
      kind: 'function',
      lineStart: content.slice(0, match.index).split('\n').length,
      lineEnd: content.slice(0, match.index).split('\n').length,
    });
  }

  return {
    imports: uniqueNames(imports),
    exports: uniqueNames(exportRecords.map((r) => r.name)),
    importRecords,
    exportRecords,
    functionRecords,
    parseMode: 'regex',
  };
}

function parseGoRegex(content) {
  const imports = [];
  const importRecords = [];
  const exportRecords = [];
  const functionRecords = [];

  const singleImport = /^\s*import\s+"([^"]+)"/gm;
  let match;
  while ((match = singleImport.exec(content)) !== null) {
    imports.push(match[1]);
    importRecords.push(createImportRecord(match[1], { usesAllExports: true }));
  }

  const blockImport = /^\s*import\s+\(([\s\S]*?)\)/gm;
  let blockMatch;
  while ((blockMatch = blockImport.exec(content)) !== null) {
    const inner = blockMatch[1];
    const innerRegex = /"([^"]+)"/g;
    let innerMatch;
    while ((innerMatch = innerRegex.exec(inner)) !== null) {
      imports.push(innerMatch[1]);
      importRecords.push(createImportRecord(innerMatch[1], { usesAllExports: true }));
    }
  }

  const typeRegex = /\btype\s+([A-Z]\w*)/g;
  while ((match = typeRegex.exec(content)) !== null) {
    exportRecords.push(createExportRecord(match[1], { kind: 'type' }));
  }
  const funcRegex = /\bfunc\s+(?:\([^)]*\)\s+)?([A-Z]\w*)\s*\(/g;
  while ((match = funcRegex.exec(content)) !== null) {
    exportRecords.push(createExportRecord(match[1], { kind: 'function' }));
    functionRecords.push({
      name: match[1],
      kind: 'function',
      lineStart: content.slice(0, match.index).split('\n').length,
      lineEnd: content.slice(0, match.index).split('\n').length,
    });
  }

  return {
    imports: uniqueNames(imports),
    exports: uniqueNames(exportRecords.map((r) => r.name)),
    importRecords,
    exportRecords,
    functionRecords,
    parseMode: 'regex',
  };
}

function parseRust(content) {
  const imports = [];
  const importRecords = [];
  const exportRecords = [];
  const functionRecords = [];

  const useRegex = /^\s*use\s+([\w:]+)(?:\s*::\s*\{([^}]*)\})?\s*;/gm;
  let match;
  while ((match = useRegex.exec(content)) !== null) {
    const prefix = match[1];
    const braceContent = match[2];
    if (braceContent) {
      const items = braceContent.split(',').map((s) => s.trim()).filter(Boolean);
      for (const item of items) {
        if (item === 'self') {
          imports.push(prefix);
          importRecords.push(createImportRecord(prefix, { usesAllExports: false }));
        } else {
          const fullPath = `${prefix}::${item}`;
          imports.push(fullPath);
          importRecords.push(createImportRecord(fullPath, { usesAllExports: false }));
        }
      }
    } else {
      imports.push(prefix);
      importRecords.push(createImportRecord(prefix, { usesAllExports: prefix.endsWith('::*') }));
    }
  }

  const fnRegex = /\bpub\s+(?:async\s+)?fn\s+(\w+)/g;
  while ((match = fnRegex.exec(content)) !== null) {
    exportRecords.push(createExportRecord(match[1], { kind: 'function' }));
    functionRecords.push({
      name: match[1],
      kind: 'function',
      lineStart: content.slice(0, match.index).split('\n').length,
      lineEnd: content.slice(0, match.index).split('\n').length,
    });
  }
  const structRegex = /\bpub\s+struct\s+(\w+)/g;
  while ((match = structRegex.exec(content)) !== null) {
    exportRecords.push(createExportRecord(match[1], { kind: 'struct' }));
  }
  const enumRegex = /\bpub\s+enum\s+(\w+)/g;
  while ((match = enumRegex.exec(content)) !== null) {
    exportRecords.push(createExportRecord(match[1], { kind: 'enum' }));
  }
  const traitRegex = /\bpub\s+trait\s+(\w+)/g;
  while ((match = traitRegex.exec(content)) !== null) {
    exportRecords.push(createExportRecord(match[1], { kind: 'trait' }));
  }
  const typeRegexRust = /\bpub\s+type\s+(\w+)/g;
  while ((match = typeRegexRust.exec(content)) !== null) {
    exportRecords.push(createExportRecord(match[1], { kind: 'type' }));
  }
  const modRegex = /\bpub\s+mod\s+(\w+)/g;
  while ((match = modRegex.exec(content)) !== null) {
    exportRecords.push(createExportRecord(match[1], { kind: 'module' }));
  }
  const constRegex = /\bpub\s+const\s+(\w+)/g;
  while ((match = constRegex.exec(content)) !== null) {
    exportRecords.push(createExportRecord(match[1], { kind: 'const' }));
  }
  const staticRegex = /\bpub\s+static\s+(\w+)/g;
  while ((match = staticRegex.exec(content)) !== null) {
    exportRecords.push(createExportRecord(match[1], { kind: 'static' }));
  }
  const useReexportRegex = /\bpub\s+use\s+([\w:]+)(?:\s+as\s+(\w+))?\s*;/g;
  while ((match = useReexportRegex.exec(content)) !== null) {
    const name = match[2] || match[1].split('::').pop();
    exportRecords.push(createExportRecord(name, { kind: 'reexport' }));
  }

  return {
    imports: uniqueNames(imports),
    exports: uniqueNames(exportRecords.map((r) => r.name)),
    importRecords,
    exportRecords,
    functionRecords,
    parseMode: 'regex',
  };
}

module.exports = { parseKotlin, parseGoRegex, parseRust };
