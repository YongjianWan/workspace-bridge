/**
 * Axum framework detection query — tree-sitter query for content-based detection.
 * Matches: Router::new / axum::extract
 * Grammar: Rust (tree-sitter-rust).
 */

const QUERY = `
(scoped_identifier (identifier) @namespace (identifier) @member)
`;

function postProcess(matches) {
  if (!matches || matches.length === 0) return null;
  for (const match of matches) {
    const ns = match.namespace?.text;
    const member = match.member?.text;
    if (
      (ns === 'Router' && member === 'new') ||
      (ns === 'axum' && member === 'extract')
    ) {
      return {
        framework: 'axum',
        reason: 'axum-routing',
        isEntry: true,
        entryPointWeight: 2.5,
      };
    }
  }
  return null;
}

module.exports = {
  language: 'rust',
  framework: 'axum',
  purpose: 'framework-detection',
  query: QUERY,
  postProcess,
};
