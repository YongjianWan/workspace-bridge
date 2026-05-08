/**
 * Framework implicit dependency pipeline — Scanner → Extractor → Resolver
 *
 * Detects framework-specific call patterns (e.g. Vue router lazy-loading,
 * global component registration) that create implicit import edges not
 * visible to static import analysis. These edges are injected into the
 * dependency graph to eliminate orphan / dead-export false positives.
 */
const fs = require('fs');
const path = require('path');
const { resolveImport } = require('./resolvers');
const { createImportRecord } = require('./parsers/shared');

// Extensions that may contain framework usage patterns.
const SCANNER_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.vue', '.mjs', '.cjs']);

/**
 * Configuration table of { scanner, extractor } pairs.
 * scanner: (filePath, content) => boolean
 * extractor: (filePath, content, root) => string[] — raw import paths
 */
const FRAMEWORK_USAGE_PATTERNS = [
  {
    id: 'vue-router-lazy',
    frameworks: ['vue'],
    scanner(filePath, content) {
      const base = path.basename(filePath).toLowerCase();
      const hasRouterPath = base.includes('router') || /[\\/]router[\\/]/i.test(filePath);
      const hasLazySyntax = /component\s*:\s*(?:\(\s*\)\s*=>|function\s*\(\s*\)\s*)\s*import\s*\(/i.test(content);
      return hasRouterPath || hasLazySyntax;
    },
    extractor(filePath, content) {
      const sources = [];
      // Match component: <anything> import('...') with non-greedy prefix
      const regex = /component\s*:\s*.*?import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
      let match;
      while ((match = regex.exec(content)) !== null) {
        sources.push(match[1]);
      }
      return sources;
    },
  },

  {
    id: 'vue-global-component',
    frameworks: ['vue'],
    scanner(filePath, content) {
      return /Vue\.component\s*\(/i.test(content);
    },
    extractor(filePath, content) {
      const sources = [];
      const regex = /Vue\.component\s*\(\s*['"]([^'"]+)['"]\s*,/g;
      let match;
      while ((match = regex.exec(content)) !== null) {
        const componentName = match[1];
        // Naming convention: components/SvgIcon/index.vue or components/SvgIcon.vue
        sources.push(`@/components/${componentName}/index`);
        sources.push(`@/components/${componentName}`);
      }
      return sources;
    },
  },

  // Placeholder: Vue custom directives require template scanning.
  {
    id: 'vue-custom-directive',
    frameworks: ['vue'],
    scanner() { return false; },
    extractor() { return []; },
  },

  // Placeholder: dynamic string calls require semantic analysis.
  {
    id: 'dynamic-string-call',
    frameworks: [],
    scanner() { return false; },
    extractor() { return []; },
  },
];

/**
 * Scan a single file and return raw implicit import sources.
 * @returns {Array<{source: string, patternId: string}>}
 */
function scanAndExtractImplicitImports(filePath, content) {
  const ext = path.extname(filePath).toLowerCase();
  if (!SCANNER_EXTENSIONS.has(ext)) return [];

  const results = [];
  for (const pattern of FRAMEWORK_USAGE_PATTERNS) {
    if (!pattern.scanner(filePath, content)) continue;
    const extracted = pattern.extractor(filePath, content);
    for (const source of extracted) {
      results.push({ source, patternId: pattern.id });
    }
  }
  return results;
}

/**
 * Resolve extracted implicit sources to absolute file paths.
 * @returns {Array<{source: string, resolved: string, patternId: string}>}
 */
function resolveImplicitImports(filePath, implicitSources, root) {
  const results = [];
  const ext = path.extname(filePath) || '.js';
  const seen = new Set();

  for (const { source, patternId } of implicitSources) {
    if (seen.has(source)) continue;
    seen.add(source);

    const resolved = resolveImport(filePath, source, ext, root);
    if (resolved && fs.existsSync(resolved)) {
      results.push({ source, resolved, patternId });
    }
  }
  return results;
}

/**
 * Build an import record suitable for injecting into the graph.
 */
function buildImplicitImportRecord(source, resolvedPath, patternId) {
  const record = createImportRecord(source, { usesAllExports: true });
  record.resolved = resolvedPath;
  record.isImplicit = true;
  record.patternId = patternId;
  return record;
}

module.exports = {
  FRAMEWORK_USAGE_PATTERNS,
  scanAndExtractImplicitImports,
  resolveImplicitImports,
  buildImplicitImportRecord,
};
