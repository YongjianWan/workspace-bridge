const path = require('path');

/**
 * Extension → language mapping for AST rule selection.
 * Keeps rule language resolution declarative and easy to extend.
 *
 * Note: this is intentionally finer-grained than the language registry
 * (e.g. TypeScript is split from JavaScript) because AST style rules care
 * about whether a file uses type annotations.
 */
const EXT_TO_LANGUAGE = {
  '.java': 'java',
  '.kt': 'kotlin',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.c': 'cpp',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.h': 'cpp',
  '.hpp': 'cpp',
  '.vue': 'vue',
  '.svelte': 'svelte',
};

// Go verb prefixes that strongly imply side effects or I/O.
// Used by exported-function-missing-error-return to avoid flagging pure helpers
// such as String(), Len(), or Format().
const GO_MUTATING_PREFIXES = ['Create', 'Update', 'Delete', 'Save', 'Run'];

function hasGoMutatingPrefix(name) {
  return GO_MUTATING_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function goReturnTypeIncludesError(returnType) {
  if (!returnType) return false;
  return /\berror\b/.test(returnType);
}

function fileUsesTypeScriptSyntax(functionRecords) {
  return functionRecords.some((fn) => Boolean(fn.returnType) || fn.hasParameterTypeHints === true);
}

const RULES = [
  {
    id: 'batch-no-transactional',
    language: ['java', 'kotlin'],
    match: (fn) => /^batch/i.test(fn.name) && !fn.decorators?.some(d => /Transactional/i.test(d)),
    severity: 'medium',
    message: (fn) => `${fn.name} lacks @Transactional annotation`,
  },
  {
    id: 'exported-function-no-return-type',
    language: ['typescript', 'javascript', 'vue', 'svelte'],
    match: (fn, ctx) => {
      if (fn.kind !== 'function' || !fn.isExported) return false;
      if (fn.returnType) return false;
      // TypeScript files are expected to annotate exported function return
      // types, so flag unconditionally. For JavaScript/Vue/Svelte, only flag
      // when the file already demonstrates TS-style annotations elsewhere;
      // this avoids noise in plain-JS projects where return types are not
      // idiomatic.
      return ctx?.lang === 'typescript' || ctx?.fileUsesTypeScriptSyntax;
    },
    severity: 'low',
    message: (fn) => `Exported function ${fn.name} has no return type annotation`,
  },
  {
    id: 'public-function-no-type-hints',
    language: ['python'],
    match: (fn) => {
      if (!fn.isExported || fn.kind !== 'function') return false;
      const paramCount = fn.fingerprint?.paramCount ?? 0;
      // Only flag when we are certain the function has parameters but zero type
      // hints (neither args nor return). hasParameterTypeHints === undefined in
      // regex fallback means "unknown", so we skip to avoid false positives.
      return paramCount > 0 && !fn.returnType && fn.hasParameterTypeHints === false;
    },
    severity: 'low',
    message: (fn) => `Public function ${fn.name} has parameters but no type hints`,
  },
  {
    id: 'exported-function-missing-error-return',
    language: ['go'],
    match: (fn) => {
      if (!fn.isExported || fn.kind !== 'function') return false;
      // Conservative: only flag exported functions whose names suggest they
      // perform side effects / I/O and do not already return error.
      // This avoids noise on pure helpers such as String() or Len().
      return hasGoMutatingPrefix(fn.name) && !goReturnTypeIncludesError(fn.returnType);
    },
    severity: 'medium',
    message: (fn) => `Exported function ${fn.name} should return error`,
  },
  {
    id: 'public-function-no-return-type',
    language: ['rust'],
    match: (fn) => fn.isExported && fn.kind === 'function' && !fn.returnType,
    severity: 'low',
    message: (fn) => `Public function ${fn.name} has no explicit return type`,
  },
  {
    id: 'exported-function-no-return-type',
    language: ['cpp'],
    match: (fn) => fn.isExported && fn.kind === 'function' && !fn.returnType,
    severity: 'low',
    message: (fn) => `Exported function ${fn.name} has no return type declaration`,
  },
];

/**
 * Checks a single file's function records against rules matching the file language.
 *
 * @param {string} graphKey - Normalized graph key
 * @param {object} info - Graph node information containing functionRecords
 * @param {object[]} [customRules=[]] - Optional custom rules to execute
 * @returns {object[]} Array of findings
 */
function checkFileRules(graphKey, info, customRules = []) {
  if (!info || !info.functionRecords || info.functionRecords.length === 0) {
    return [];
  }

  const ext = path.extname(info.originalPath || '').toLowerCase();
  const lang = EXT_TO_LANGUAGE[ext] || null;

  if (!lang) return [];

  const activeRules = [...RULES, ...customRules].filter((r) => r.language.includes(lang));
  if (activeRules.length === 0) return [];

  const ctx = {
    lang,
    fileUsesTypeScriptSyntax: fileUsesTypeScriptSyntax(info.functionRecords),
  };

  const findings = [];
  for (const fn of info.functionRecords) {
    for (const rule of activeRules) {
      if (rule.match(fn, ctx)) {
        findings.push({
          id: `ast-rule:${rule.id}:${info.originalPath}:${fn.name}`,
          category: 'ast-rules',
          file: info.originalPath,
          symbol: fn.name,
          severity: rule.severity,
          message: rule.message(fn),
        });
      }
    }
  }

  return findings;
}

/**
 * Checks all files in the graph against AST rules.
 *
 * @param {Map} graph - The dependency graph map
 * @param {object[]} [customRules=[]] - Optional custom rules
 * @returns {object[]} Array of findings
 */
function checkAllRules(graph, customRules = []) {
  const findings = [];
  for (const [key, info] of graph) {
    const fileFindings = checkFileRules(key, info, customRules);
    findings.push(...fileFindings);
  }
  return findings;
}

module.exports = {
  RULES,
  EXT_TO_LANGUAGE,
  checkFileRules,
  checkAllRules,
};
