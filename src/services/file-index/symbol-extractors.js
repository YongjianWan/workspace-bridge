/**
 * Symbol extractors per language — registered as a first-match lookup table.
 * Each extractor receives an array of lines and returns {name, type, line, signature}[].
 */

function extractPythonSymbols(lines) {
  const symbols = [];
  lines.forEach((line, idx) => {
    const classMatch = line.match(/^class\s+(\w+)/);
    const funcMatch = line.match(/^(?:async\s+)?def\s+(\w+)/);
    if (classMatch) {
      symbols.push({ name: classMatch[1], type: 'class', line: idx + 1, signature: line.trim() });
    } else if (funcMatch) {
      symbols.push({ name: funcMatch[1], type: 'function', line: idx + 1, signature: line.trim() });
    }
  });
  return symbols;
}

function extractJsSymbols(lines) {
  const symbols = [];
  lines.forEach((line, idx) => {
    const classMatch = line.match(/(?:export\s+)?(?:default\s+)?class\s+(\w+)/);
    const funcMatch = line.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)/);
    const constMatch = line.match(/(?:export\s+)?const\s+(\w+)\s*=/);
    if (classMatch) {
      symbols.push({ name: classMatch[1], type: 'class', line: idx + 1, signature: line.trim() });
    } else if (funcMatch) {
      symbols.push({ name: funcMatch[1], type: 'function', line: idx + 1, signature: line.trim() });
    } else if (constMatch) {
      symbols.push({ name: constMatch[1], type: 'constant', line: idx + 1, signature: line.trim() });
    }
  });
  return symbols;
}

function extractJavaSymbols(lines) {
  const symbols = [];
  lines.forEach((line, idx) => {
    const typeMatch = line.match(/\b(?:public\s+)?(?:abstract\s+|final\s+)?(class|interface|enum|record)\s+(\w+)/);
    if (typeMatch) {
      symbols.push({ name: typeMatch[2], type: typeMatch[1], line: idx + 1, signature: line.trim() });
    }
    const methodMatch = line.match(/\bpublic\s+(?:static\s+)?(?:[\w<>,\[\]\s]+)\s+(\w+)\s*\(/);
    if (methodMatch) {
      symbols.push({ name: methodMatch[1], type: 'method', line: idx + 1, signature: line.trim() });
    }
  });
  return symbols;
}

function extractKotlinSymbols(lines) {
  const symbols = [];
  lines.forEach((line, idx) => {
    const typeMatch = line.match(/\b(?:public\s+)?(?:abstract\s+|open\s+|data\s+)?(class|interface|object|enum)\s+(\w+)/);
    if (typeMatch) {
      symbols.push({ name: typeMatch[2], type: typeMatch[1], line: idx + 1, signature: line.trim() });
    }
    const funMatch = line.match(/\bfun\s+(\w+)\s*\(/);
    if (funMatch) {
      symbols.push({ name: funMatch[1], type: 'function', line: idx + 1, signature: line.trim() });
    }
  });
  return symbols;
}

function extractGoSymbols(lines) {
  const symbols = [];
  lines.forEach((line, idx) => {
    const typeMatch = line.match(/\btype\s+(\w+)/);
    const funcMatch = line.match(/\bfunc\s+(?:\([^)]*\)\s+)?(\w+)\s*\(/);
    if (typeMatch) {
      symbols.push({ name: typeMatch[1], type: 'type', line: idx + 1, signature: line.trim() });
    } else if (funcMatch) {
      symbols.push({ name: funcMatch[1], type: 'function', line: idx + 1, signature: line.trim() });
    }
  });
  return symbols;
}

function extractRustSymbols(lines) {
  const symbols = [];
  lines.forEach((line, idx) => {
    const fnMatch = line.match(/\bfn\s+(\w+)\s*\(/);
    const structMatch = line.match(/\bstruct\s+(\w+)/);
    if (fnMatch) {
      symbols.push({ name: fnMatch[1], type: 'function', line: idx + 1, signature: line.trim() });
    } else if (structMatch) {
      symbols.push({ name: structMatch[1], type: 'struct', line: idx + 1, signature: line.trim() });
    }
  });
  return symbols;
}

// First-match registry: each extension maps to its extractor.
// Unknown extensions naturally fall through to an empty result.
const SYMBOL_EXTRACTORS = {
  '.py': extractPythonSymbols,
  '.js': extractJsSymbols,
  '.ts': extractJsSymbols,
  '.jsx': extractJsSymbols,
  '.tsx': extractJsSymbols,
  '.java': extractJavaSymbols,
  '.kt': extractKotlinSymbols,
  '.go': extractGoSymbols,
  '.rs': extractRustSymbols,
};

function extractSymbols(content, ext) {
  const extractor = SYMBOL_EXTRACTORS[ext];
  if (!extractor) return [];
  return extractor(content.split('\n'));
}

module.exports = { extractSymbols };
