/**
 * Flask framework detection query — tree-sitter query for content-based detection.
 *
 * Matches route decorators on any object:
 *   @app.route('/path') / @bp.route('/path') / etc.
 *
 * NOTE: #match? predicates are NOT supported by web-tree-sitter WASM;
 * all filtering is done in postProcess.
 */

const { ENTRY_WEIGHT } = require('../../../../utils/project-context');

const QUERY = `
; @<obj>.route(...)
(decorator
  (call
    function: (attribute
      object: (identifier) @app_obj
      attribute: (identifier) @route_attr
    )
  )
)
`;

function postProcess(matches) {
  if (!matches || matches.length === 0) return null;

  for (const match of matches) {
    if (match.route_attr?.text === 'route') {
      return {
        framework: 'flask',
        reason: 'flask-decorator',
        isEntry: true,
        entryPointWeight: ENTRY_WEIGHT.MEDIUM_HIGH,
      };
    }
  }

  return null;
}

module.exports = {
  language: 'python',
  framework: 'flask',
  purpose: 'framework-detection',
  query: QUERY,
  postProcess,
};
