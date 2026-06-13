/**
 * FastAPI route extraction query — tree-sitter query for decorator-based routes.
 *
 * Matches: @app.get('/path') / @router.post('/path') / etc.
 * Ignores: @app.route('/path') (Flask-style) and other non-HTTP decorators.
 * Grammar: Python (tree-sitter-python).
 */

const { stripQuotes } = require('../../parsers/tree-sitter');

const QUERY = `
(decorator
  (call
    function: (attribute
      object: (identifier) @obj
      attribute: (identifier) @method
    )
    arguments: (argument_list
      . (string) @route
    )
  )
)
`;

// FastAPI exposes the standard HTTP verbs as decorator methods on the app/router.
const VALID_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch']);

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
      framework: 'fastapi',
      handler: null,
    });
  }

  return routes;
}

module.exports = {
  language: 'python',
  framework: 'fastapi',
  purpose: 'route-extraction',
  query: QUERY,
  postProcess,
};
