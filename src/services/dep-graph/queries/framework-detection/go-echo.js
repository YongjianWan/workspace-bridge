/**
 * Echo framework detection query — tree-sitter query for content-based detection.
 * Matches: echo.Context / echo.New()
 * Grammar: Go (tree-sitter-go).
 */

const QUERY = `
[
  (selector_expression operand: (package_identifier) @package field: (field_identifier) @field)
  (qualified_type package: (package_identifier) @package name: (type_identifier) @name)
]
`;

function postProcess(matches) {
  if (!matches || matches.length === 0) return null;
  for (const match of matches) {
    const pkg = match.package?.text;
    const field = match.field?.text || match.name?.text;
    if (pkg === 'echo' && (field === 'Context' || field === 'New')) {
      return {
        framework: 'echo',
        reason: 'echo-handler',
        isEntry: true,
        entryPointWeight: 2.5,
      };
    }
  }
  return null;
}

module.exports = {
  language: 'go',
  framework: 'echo',
  purpose: 'framework-detection',
  query: QUERY,
  postProcess,
};
