/**
 * FastAPI framework detection query — tree-sitter query for content-based detection.
 *
 * Matches HTTP-verb decorators on any object:
 *   @app.get('/path') / @router.post('/path') / etc.
 *
 * NOTE: #match? predicates are NOT supported by web-tree-sitter WASM;
 * all filtering is done in postProcess.
 */

const { ENTRY_WEIGHT } = require('../../../../utils/project-context');

const QUERY = `
; @<obj>.<http>(...)
(decorator
  (call
    function: (attribute
      object: (identifier) @app_obj
      attribute: (identifier) @http_method
    )
  )
)
`;

const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch']);

function postProcess(matches) {
  if (!matches || matches.length === 0) return null;

  for (const match of matches) {
    const method = match.http_method?.text?.toLowerCase();
    if (method && HTTP_METHODS.has(method)) {
      return {
        framework: 'fastapi',
        reason: 'fastapi-decorator',
        isEntry: true,
        entryPointWeight: ENTRY_WEIGHT.MEDIUM_HIGH,
      };
    }
  }

  return null;
}

module.exports = {
  language: 'python',
  framework: 'fastapi',
  purpose: 'framework-detection',
  query: QUERY,
  postProcess,
};
