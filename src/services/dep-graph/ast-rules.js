const path = require('path');

const RULES = [
  {
    id: 'batch-no-transactional',
    language: ['java', 'kotlin'],
    match: (fn) => /^batch/i.test(fn.name) && !fn.decorators?.some(d => /Transactional/i.test(d)),
    severity: 'medium',
    message: (fn) => `${fn.name} lacks @Transactional annotation`,
  },
  {
    id: 'public-method-no-return-type',
    language: ['typescript'],
    match: (fn) => fn.isExported && !fn.returnType && fn.kind === 'function',
    severity: 'low',
    message: (fn) => `Exported function ${fn.name} has no return type annotation`,
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
  let lang = null;
  if (ext === '.java') lang = 'java';
  else if (ext === '.kt') lang = 'kotlin';
  else if (ext === '.ts' || ext === '.tsx') lang = 'typescript';

  if (!lang) return [];

  const activeRules = [...RULES, ...customRules].filter((r) => r.language.includes(lang));
  if (activeRules.length === 0) return [];

  const findings = [];
  for (const fn of info.functionRecords) {
    for (const rule of activeRules) {
      if (rule.match(fn)) {
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
  checkFileRules,
  checkAllRules,
};
