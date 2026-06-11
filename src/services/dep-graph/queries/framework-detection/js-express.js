/**
 * Express framework detection query — tree-sitter query for content-based detection.
 *
 * Matches: app.get(...) / router.post(...) / r.put(...) / etc.
 * Grammar: TypeScript (tree-sitter-typescript).
 *
 * NOTE: #match? predicates are NOT supported by web-tree-sitter WASM;
 * any filtering must be done in postProcess. This query is Phase 3
 * infrastructure — not yet wired into detectFrameworkFromContent.
 */

const QUERY = `
(call_expression
  function: (member_expression
    object: (identifier) @app
    property: (property_identifier) @method
  )
)
(#match? @app "^(app|router|r)$")
(#match? @method "^(get|post|put|delete|patch|all)$")
`;

function postProcess(matches) {
  if (matches.length > 0) {
    return {
      framework: 'express',
      reason: 'express-route',
      isEntry: true,
      entryPointWeight: 2.5,
    };
  }
  return null;
}

module.exports = {
  language: 'typescript',
  framework: 'express',
  purpose: 'framework-detection',
  query: QUERY,
  postProcess,
};
