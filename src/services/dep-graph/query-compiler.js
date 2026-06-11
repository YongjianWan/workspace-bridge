/**
 * Query compiler — compile and cache tree-sitter queries for framework detection.
 *
 * Design reference: existing AST parsers (go-ast.js / rust-ast.js / kotlin-ast.js)
 * follow the same pattern: getParserModule → loadLanguage → new Query → matches.
 *
 * This module adds:
 *   1. Query compilation with SHA-256 keyed caching.
 *   2. LRU eviction to prevent unbounded memory growth.
 *   3. Unified error handling: any failure returns null (caller falls back).
 */

const crypto = require('crypto');
const { getParserModule, loadLanguage } = require('./parsers/tree-sitter');

const MAX_QUERY_CACHE_SIZE = 20;
const queryCache = new Map();

function hashQuerySource(source) {
  return crypto.createHash('sha256').update(source).digest('hex').slice(0, 16);
}

/**
 * Compile a tree-sitter query for the given language.
 * Returns a compiled query object or null on any failure.
 * Compiled queries are cached by (language + querySource SHA-256).
 * @param {string} language — tree-sitter language name (e.g. 'typescript', 'go')
 * @param {string} querySource — tree-sitter query string
 * @returns {Promise<{query: Query, language: Language, cacheKey: string} | null>}
 */
async function compileQuery(language, querySource) {
  const cacheKey = `${language}:${hashQuerySource(querySource)}`;

  const cached = queryCache.get(cacheKey);
  if (cached) return cached;

  let mod;
  let lang;
  let query;

  try {
    mod = await getParserModule();
    if (!mod) return null;

    lang = await loadLanguage(language);
    if (!lang) return null;

    query = new mod.Query(lang, querySource);
  } catch {
    return null;
  }

  const compiled = { query, language: lang, cacheKey };

  // LRU-like eviction: Map preserves insertion order.
  if (queryCache.size >= MAX_QUERY_CACHE_SIZE) {
    const firstKey = queryCache.keys().next().value;
    if (firstKey !== undefined) {
      const old = queryCache.get(firstKey);
      queryCache.delete(firstKey);
      try { old.query.delete(); } catch {}
    }
  }

  queryCache.set(cacheKey, compiled);
  return compiled;
}

/**
 * Run a compiled query against a parsed tree.
 * Returns an array of capture groups or null on failure.
 * @param {Tree} tree — parsed tree from parser.parse()
 * @param {{query: Query, language: Language}} compiledQuery — result from compileQuery()
 * @returns {Array<Record<string, {name: string, node: TreeNode, text: string}>> | null}
 */
function runQuery(tree, compiledQuery) {
  if (!tree || !compiledQuery || !compiledQuery.query) return null;

  try {
    const matches = compiledQuery.query.matches(tree.rootNode);
    const results = [];

    for (const match of matches) {
      const captures = {};
      for (const capture of match.captures) {
        captures[capture.name] = {
          name: capture.name,
          node: capture.node,
          text: capture.node.text,
          startPosition: capture.node.startPosition,
          endPosition: capture.node.endPosition,
        };
      }
      results.push(captures);
    }

    return results;
  } catch {
    return null;
  }
}

/**
 * Clear the query cache and delete all compiled Query objects.
 * Useful for tests and memory-constrained environments.
 */
function clearQueryCache() {
  for (const { query } of queryCache.values()) {
    try { query.delete(); } catch {}
  }
  queryCache.clear();
}

/**
 * Get the current cache size (for diagnostics / tests).
 * @returns {number}
 */
function getQueryCacheSize() {
  return queryCache.size;
}

module.exports = {
  compileQuery,
  runQuery,
  clearQueryCache,
  getQueryCacheSize,
  hashQuerySource,
};
