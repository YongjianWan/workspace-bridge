/**
 * Actix-web route extraction query — tree-sitter query for attribute-macro routes.
 *
 * Matches: #[get("/path")] / #[post("/path")] / #[put("/path")] / #[delete("/path")] / #[patch("/path")]
 * Also matches scoped macros: #[actix_web::get("/path")]
 * Ignores: other attributes without a route string argument (e.g. #[derive(Debug)])
 * Grammar: Rust (tree-sitter-rust).
 */

const { stripQuotes } = require('../../parsers/tree-sitter');

const QUERY = `
(attribute_item
  (attribute
    [
      (identifier) @method
      (scoped_identifier) @method
    ]
    (token_tree
      (string_literal) @route
    )
  )
)
`;

const VALID_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch']);

function lastSegment(text) {
  if (!text) return '';
  // Scoped identifier like "actix_web::get" → "get".
  const parts = text.split('::');
  return parts[parts.length - 1] || '';
}

function postProcess(matches) {
  const routes = [];
  const seen = new Set();

  for (const capture of matches) {
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
      framework: 'actix-web',
      handler: null,
    });
  }

  return routes;
}

module.exports = {
  language: 'rust',
  framework: 'actix-web',
  purpose: 'route-extraction',
  query: QUERY,
  postProcess,
};
