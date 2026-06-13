/**
 * Gin route extraction query — tree-sitter query for static route declarations.
 *
 * Matches: r.GET("/path", handler) / router.POST("/path", handler) / etc.
 * Ignores: method names outside the HTTP verb set (e.g. fmt.Println).
 * Grammar: Go (tree-sitter-go).
 */

const { stripQuotes } = require('../../parsers/tree-sitter');

const QUERY = `
(call_expression
  function: (selector_expression
    field: (field_identifier) @method
  )
  arguments: (argument_list
    . [(interpreted_string_literal) (raw_string_literal)] @route
  )
)
`;

// P102: HTTP verbs supported by Gin's router API.
const VALID_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']);

function postProcess(matches) {
  const routes = [];
  const seen = new Set();

  for (const capture of matches) {
    const methodRaw = capture.method?.text;
    // Strip surrounding backticks for raw string literals in addition to regular quotes.
    const routePath = stripQuotes(capture.route?.text || '').replace(/^`|`$/g, '');

    if (!VALID_METHODS.has(methodRaw)) continue;
    if (!routePath) continue;

    const method = methodRaw.toUpperCase();
    const dedup = `${method}:${routePath}`;
    if (seen.has(dedup)) continue;
    seen.add(dedup);

    routes.push({
      method,
      path: routePath,
      framework: 'gin',
      handler: null,
    });
  }

  return routes;
}

module.exports = {
  language: 'go',
  framework: 'gin',
  purpose: 'route-extraction',
  query: QUERY,
  postProcess,
};
