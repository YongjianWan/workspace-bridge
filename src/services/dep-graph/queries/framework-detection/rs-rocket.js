/**
 * Rocket framework detection query — tree-sitter query for content-based detection.
 * Matches: #[get(...)] / #[post(...)] / #[launch]
 * Grammar: Rust (tree-sitter-rust).
 */

const QUERY = `
[
  (identifier) @id
]
`;

function postProcess(matches) {
  if (!matches || matches.length === 0) return null;
  let hasRocketRef = false;
  let hasLaunch = false;

  for (const match of matches) {
    const id = match.id?.text;

    if (id === 'rocket') {
      hasRocketRef = true;
    }
    if (id === 'launch') {
      hasLaunch = true;
    }
  }

  if (hasRocketRef || hasLaunch) {
    return {
      framework: 'rocket',
      reason: 'rocket-attribute',
      isEntry: true,
      entryPointWeight: 3.0,
    };
  }
  return null;
}

module.exports = {
  language: 'rust',
  framework: 'rocket',
  purpose: 'framework-detection',
  query: QUERY,
  postProcess,
};
