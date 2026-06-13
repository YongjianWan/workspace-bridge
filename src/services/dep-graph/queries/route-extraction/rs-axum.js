/**
 * Axum route extraction query — tree-sitter query for builder-style routing.
 *
 * Matches: Router::new().route("/path", get(handler))
 *          app.route("/path", routing::get(handler))
 * Ignores: other method calls named "route" without a recognized HTTP verb as
 *          the second argument.
 * Grammar: Rust (tree-sitter-rust).
 */

const { stripQuotes } = require('../../parsers/tree-sitter');

const QUERY = `
(call_expression
  function: (field_expression
    field: (field_identifier) @fn
  )
  arguments: (arguments
    . (string_literal) @route
    . (call_expression
      function: [
        (identifier) @method
        (scoped_identifier) @method
      ]
    )
  )
)
`;

const VALID_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch']);

function lastSegment(text) {
  if (!text) return '';
  // Scoped identifier like "routing::get" → "get".
  const parts = text.split('::');
  return parts[parts.length - 1] || '';
}

function postProcess(matches) {
  const routes = [];
  const seen = new Set();

  for (const capture of matches) {
    // Field must be the `.route(...)` builder method; other field names are
    // rejected here to keep the query focused on route registration.
    if (capture.fn?.text !== 'route') continue;

    const methodRaw = lastSegment(capture.method?.text).toLowerCase();
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
      framework: 'axum',
      handler: null,
    });
  }

  return routes;
}

module.exports = {
  language: 'rust',
  framework: 'axum',
  purpose: 'route-extraction',
  query: QUERY,
  postProcess,
};
