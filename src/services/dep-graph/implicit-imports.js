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
const { resolveImport, cachedExistsSync } = require('./resolvers');
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

  {
    id: 'vue-custom-directive',
    frameworks: ['vue'],
    scanner(filePath, content) {
      return /(?:Vue|app)\.directive\s*\(\s*['"]/.test(content);
    },
    extractor(filePath, content) {
      const sources = [];
      const regex = /(?:Vue|app)\.directive\s*\(\s*['"]([a-zA-Z0-9-]+)['"]\s*,/g;
      let match;
      while ((match = regex.exec(content)) !== null) {
        const directiveName = match[1];
        // Vue convention: src/directive/xxx/index.js or src/directive/xxx.js
        sources.push(`@/directive/${directiveName}/index`);
        sources.push(`@/directive/${directiveName}`);
      }
      return sources;
    },
  },

  // P104: React.lazy(() => import('...'))
  {
    id: 'react-lazy',
    frameworks: ['react'],
    scanner(filePath, content) {
      return /(?:React\.)?lazy\s*\(\s*(?:\(\s*\)\s*=>|function\s*\(\s*\)\s*=>?)\s*import\s*\(/i.test(content);
    },
    extractor(filePath, content) {
      const sources = [];
      const regex = /(?:React\.)?lazy\s*\(\s*(?:\(\s*\)\s*=>|function\s*\(\s*\)\s*=>?)\s*import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
      let match;
      while ((match = regex.exec(content)) !== null) {
        sources.push(match[1]);
      }
      return sources;
    },
  },

  // P104: Next.js dynamic(() => import('...'))
  {
    id: 'nextjs-dynamic',
    frameworks: ['nextjs'],
    scanner(filePath, content) {
      return /dynamic\s*\(\s*(?:\(\s*\)\s*=>|function\s*\(\s*\)\s*=>?)\s*import\s*\(/i.test(content);
    },
    extractor(filePath, content) {
      const sources = [];
      const regex = /dynamic\s*\(\s*(?:\(\s*\)\s*=>|function\s*\(\s*\)\s*=>?)\s*import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
      let match;
      while ((match = regex.exec(content)) !== null) {
        sources.push(match[1]);
      }
      return sources;
    },
  },

  // P104: Angular loadChildren: () => import('...')
  {
    id: 'angular-loadchildren',
    frameworks: ['angular'],
    scanner(filePath, content) {
      return /loadChildren\s*:\s*(?:\(\s*\)\s*=>|function\s*\(\s*\)\s*=>?)\s*import\s*\(/i.test(content);
    },
    extractor(filePath, content) {
      const sources = [];
      const regex = /loadChildren\s*:\s*(?:\(\s*\)\s*=>|function\s*\(\s*\)\s*=>?)\s*import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
      let match;
      while ((match = regex.exec(content)) !== null) {
        sources.push(match[1]);
      }
      return sources;
    },
  },

  {
    id: 'dynamic-string-call',
    frameworks: [],
    scanner(filePath, content) {
      const hasDynamicAccess = /(?:window|this)\s*\[\s*['"]?[a-zA-Z_$]/.test(content);
      const hasStringArray = /(?:const|let|var)\s+\w+\s*=\s*\[\s*(?:['"][^'"]+['"]\s*,?\s*)+\]/.test(content);
      return hasDynamicAccess || hasStringArray;
    },
    extractor(filePath, content) {
      const sources = [];

      // Pattern 1: direct string literal indexing: window['foo'], this["foo"]
      const literalIdx = /(?:window|this)\s*\[\s*['"]([a-zA-Z_$][a-zA-Z0-9_$]*)['"]\s*\]/g;
      let m;
      while ((m = literalIdx.exec(content)) !== null) {
        sources.push(`./${m[1]}`);
      }

      // Pattern 2: string array iterated into dynamic access
      // e.g. const actions = ['foo','bar']; actions.forEach(a => window[a]())
      const arrayIterRegex = /(?:const|let|var)\s+(\w+)\s*=\s*\[([^\]]+)\][\s\S]{0,800}?\1\.(?:forEach|map|some|every)\s*\(\s*(\w+)\s*=>[\s\S]{0,300}?(?:window|this)\s*\[\s*\3\s*\]/g;
      while ((m = arrayIterRegex.exec(content)) !== null) {
        const arrayContent = m[2];
        const items = arrayContent.match(/['"]([a-zA-Z_$][a-zA-Z0-9_$]*)['"]/g) || [];
        for (const item of items) {
          const name = item.slice(1, -1);
          sources.push(`./${name}`);
        }
      }

      return [...new Set(sources)];
    },
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
    if (resolved && cachedExistsSync(resolved)) {
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
