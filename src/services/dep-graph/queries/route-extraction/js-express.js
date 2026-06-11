/**
 * Express route extraction query — tree-sitter query for static route declarations.
 *
 * Matches: app.get('/path', handler) / router.post('/path', handler) / etc.
 * Grammar: TypeScript (tree-sitter-typescript), which is a superset of JS/JSX/TS/TSX.
 */

const { stripQuotes } = require('../../parsers/tree-sitter');

const QUERY = `
(call_expression
  function: (member_expression
    property: (property_identifier) @method
  )
  arguments: (arguments
    . (string) @route
  )
)
`;

const VALID_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'all']);

function postProcess(matches) {
  const routes = [];
  const seen = new Set();

  for (const capture of matches) {
    const methodRaw = capture.method?.text?.toLowerCase();
    const routePath = stripQuotes(capture.route?.text || '');

    if (!VALID_METHODS.has(methodRaw)) continue;
    if (!routePath) continue;

    const method = methodRaw.toUpperCase();
    const dedup = `${method}:${routePath}`;
    if (seen.has(dedup)) continue;
    seen.add(dedup);

    routes.push({
      method,
      path: routePath,
      framework: 'express',
      handler: null, // handler extraction: Phase 4 extension
    });
  }

  return routes;
}

module.exports = {
  language: 'typescript',
  framework: 'express',
  purpose: 'route-extraction',
  query: QUERY,
  postProcess,
};
