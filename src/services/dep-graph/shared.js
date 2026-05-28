const path = require('path');
const { DEFAULTS, LIMITS, DEAD_EXPORT, CONFIDENCE } = require('../../config/constants');

// 配置常量
const CONFIG = {
  DEFAULT_CONCURRENCY: 20,      // 默认并发数（内存安全考虑）
  DEFAULT_MAX_DEPTH: DEFAULTS.AFFECTED_TEST_DEPTH,
};

/**
 * Generic BFS traversal over a directed graph.
 * @param {string|string[]} startNodes - Starting node(s)
 * @param {Function} getNeighbors - (node) => string[]
 * @param {Object} options
 * @param {number} [options.maxDepth=Infinity]
 * @param {Function} [options.onVisit] - (node, depth, path) => any | undefined
 * @returns {any[]} collected results from onVisit
 */
function bfsTraverse(startNodes, getNeighbors, options = {}) {
  const visited = new Set();
  
  // pathRef uses a singly-linked list node format: { val: node, prev: parentRef }
  const queue = Array.isArray(startNodes)
    ? startNodes.map((n) => ({ node: n, depth: 0, pathRef: null }))
    : [{ node: startNodes, depth: 0, pathRef: null }];
    
  const maxDepth = Number.isFinite(options.maxDepth) ? options.maxDepth : Infinity;
  const results = [];

  function materializePath(ref) {
    const arr = [];
    let curr = ref;
    while (curr) {
      arr.push(curr.val);
      curr = curr.prev;
    }
    return arr.reverse();
  }

  let head = 0;
  while (head < queue.length) {
    const { node, depth, pathRef } = queue[head++];
    if (visited.has(node) || depth > maxDepth) continue;
    visited.add(node);

    if (options.onVisit) {
      const materialized = materializePath(pathRef);
      const result = options.onVisit(node, depth, materialized);
      if (result === false || result === 'STOP') {
        break; // Early termination
      }
      if (result !== undefined) results.push(result);
    }

    const currentRef = { val: node, prev: pathRef };
    for (const neighbor of getNeighbors(node)) {
      if (!visited.has(neighbor)) {
        queue.push({
          node: neighbor,
          depth: depth + 1,
          pathRef: currentRef,
        });
      }
    }
  }

  return results;
}

/**
 * Compute confidence level and human-readable reason for dead-export findings.
 * P42/P56: eliminates the previous black-box where 90% of files were 'medium'.
 *
 * Rules:
 * - high: no importers + reliable graph → entire module is unused
 * - medium: importers exist + AST parse → AST precisely identified unused symbols
 * - low:  importers exist + regex parse → regex is coarse; or unreliable graph
 *
 * NOTE: importerCount does NOT downgrade AST findings. A file may have many
 * importers (because other exports are widely used) while a specific export is
 * genuinely unused. AST-level symbol tracking is the authoritative signal.
 */
function isLikelyConstantsWarehouse(filePath, exportRecords) {
  const base = path.basename(filePath).toLowerCase();
  if (!/(constants|status|utils)\.java$/.test(base)) return false;
  if (exportRecords && exportRecords.length > 0) {
    const fieldLike = exportRecords.filter(
      (r) => r.kind === 'field' || r.kind === 'variable' || r.kind === 'const'
    ).length;
    return fieldLike / exportRecords.length >= 0.7;
  }
  return true;
}

function computeDeadExportConfidence(importerCount, parseMode, graphUnreliable) {
  if (importerCount === 0) {
    if (graphUnreliable) {
      return {
        confidence: 'low',
        confidenceValue: CONFIDENCE.LOW_VALUE,
        source: 'graph-sparse',
        reason: 'No importers, but dependency graph is sparse (possible parser miss)',
      };
    }
    return {
      confidence: 'high',
      confidenceValue: CONFIDENCE.HIGH_VALUE,
      source: 'ast-no-importer',
      reason: 'No files import this module; all exports are unused',
    };
  }

  if (parseMode === 'ast') {
    // P87: differentiate reason by importerCount to avoid templated explanations
    const base = {
      confidence: 'medium',
      confidenceValue: CONFIDENCE.MEDIUM_VALUE,
      source: 'ast-unused-exports',
    };
    if (importerCount >= DEAD_EXPORT.IMPORTER_COUNT_HIGH) {
      return { ...base, reason: `File has ${importerCount} importers, but these specific exports are not referenced by any importer` };
    }
    if (importerCount >= DEAD_EXPORT.IMPORTER_COUNT_MEDIUM) {
      return { ...base, reason: `File has ${importerCount} importers; unused exports may be internal helpers or barrel re-exports` };
    }
    return { ...base, reason: 'AST-level analysis found unused exports (dynamic imports or string calls may bypass static detection)' };
  }

  return {
    confidence: 'low',
    confidenceValue: CONFIDENCE.LOW_VALUE,
    source: 'regex-fallback',
    reason: 'Regex-based analysis; high false-positive risk',
  };
}

// #20: framework entry-file patterns promoted to module-level constant
const FRAMEWORK_MANAGED_PATTERNS = [
  /\/migrations\/.*\.py$/,
  /\/admin\.py$/,
  /\/apps\.py$/,
  /\/signals\.py$/,
  /\/tests\.py$/,
  /\/conftest\.py$/,
  /\/settings(\..+)?\.py$/,
  /\/urls\.py$/,
  /\/asgi\.py$/,
  /\/wsgi\.py$/,
  /\/manage\.py$/,
  /\/management\/commands\/.*\.py$/,
  /\/tasks\.py$/,
  // P71: Django configuration-driven entry points
  /\/middleware.*\.py$/,
  /\/database_router\.py$/,
  /\/context_processors\.py$/,
  /\/templatetags\/.*\.py$/,
  /\/forms\.py$/,
  /\/celery\.py$/,
  /\/(page|layout|loading|error|not-found|route)\.(tsx|jsx|ts|js)$/,
  /\/(template|default)\.(tsx|jsx|ts|js)$/,
  // Spring / Java framework-managed components
  /.*Controller\.java$/,
  /.*Service\.java$/,
  /.*Repository\.java$/,
  /.*Configuration\.java$/,
  /.*Config\.java$/,
  /.*Mapper\.java$/,
  /.*Client\.java$/,
  /.*Listener\.java$/,
  /.*Scheduler\.java$/,
  /.*Task\.java$/,
  // Django REST framework
  /\/serializers\.py$/,
  /\/viewsets\.py$/,
  /\/permissions\.py$/,
  /\/authentication\.py$/,
  /\/throttling\.py$/,
];

// #19: known config file names as a Set
const KNOWN_CONFIG_NAMES = new Set(['vite.config.js', 'vite.config.ts', 'vitest.config.ts', 'eslint.config.js']);

// #21: __main__ regex promoted to module-level constant
const PYTHON_MAIN_PATTERN = /if\s+__name__\s*==\s*['"]__main__['"]\s*:/;

// CRG-inspired dead-code filter chain: symbols conventionally not considered dead
const DEAD_EXPORT_FILTER_RE = {
  dunder: /^__.*__$/,
  mockLike: /^(mock|stub|spy|fake)[A-Z]/,
};

function isConventionallyAliveSymbol(name) {
  if (name === 'constructor') return false;
  if (DEAD_EXPORT_FILTER_RE.dunder.test(name)) return false;
  if (DEAD_EXPORT_FILTER_RE.mockLike.test(name)) return false;
  return true;
}

module.exports = {
  CONFIG,
  bfsTraverse,
  isLikelyConstantsWarehouse,
  computeDeadExportConfidence,
  FRAMEWORK_MANAGED_PATTERNS,
  KNOWN_CONFIG_NAMES,
  PYTHON_MAIN_PATTERN,
  DEAD_EXPORT_FILTER_RE,
  isConventionallyAliveSymbol,
};
