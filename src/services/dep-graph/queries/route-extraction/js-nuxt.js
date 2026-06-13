/**
 * Nuxt 3 route extraction query — tree-sitter query for static route hints.
 *
 * Matches:
 *   - definePageMeta({ path: '/custom' }) in script content
 *   - defineEventHandler(...) / eventHandler(...) Nitro API handlers
 *
 * Nuxt file-system routes (server/api/**.ts) derive their URL from the directory
 * layout, which is not present in file content. For those handlers we emit an
 * empty path as a marker that the file hosts route logic.
 *
 * Grammar: TypeScript (tree-sitter-typescript). The query pattern also works on
 * extracted Vue <script> content if a future pipeline parses it as TypeScript.
 */

const { stripQuotes } = require('../../parsers/tree-sitter');

// We intentionally match all call_expressions with identifier functions and
// filter by name in postProcess, because web-tree-sitter WASM does not support
// #match?/#eq? predicates (see framework-detection/js-express.js).
const QUERY = `
[
  (call_expression
    function: (identifier) @fn
    arguments: (arguments
      (object
        (pair
          key: (property_identifier) @key
          value: (string) @route
        )
      )
    )
  )
  (call_expression
    function: (identifier) @fn
    arguments: (arguments)
  )
]
`;

// Nuxt/Nitro runtime markers that expose this file as a route entry.
const VALID_FNS = new Set(['definePageMeta', 'defineEventHandler', 'eventHandler']);

function postProcess(matches) {
  const routes = [];
  const seen = new Set();

  for (const capture of matches) {
    const fn = capture.fn?.text;
    if (!VALID_FNS.has(fn)) continue;

    if (fn === 'definePageMeta') {
      const key = capture.key?.text;
      const routePath = stripQuotes(capture.route?.text || '');
      if (key === 'path' && routePath) {
        const dedup = `ALL:${routePath}`;
        if (seen.has(dedup)) continue;
        seen.add(dedup);
        routes.push({
          method: 'ALL',
          path: routePath,
          framework: 'nuxt',
          handler: null,
        });
      }
    } else {
      // defineEventHandler / eventHandler: Nitro file-system handler.
      // The actual URL is encoded in the server/api/** directory layout, which
      // is unavailable from content alone. Emit an empty path as a presence
      // marker for impact analysis.
      const dedup = 'ALL:';
      if (seen.has(dedup)) continue;
      seen.add(dedup);
      routes.push({
        method: 'ALL',
        path: '',
        framework: 'nuxt',
        handler: null,
      });
    }
  }

  return routes;
}

module.exports = {
  language: 'typescript',
  framework: 'nuxt',
  purpose: 'route-extraction',
  query: QUERY,
  postProcess,
};
