/**
 * Rocket framework detection query — tree-sitter query for content-based detection.
 * Matches: #[get(...)] / #[post(...)] / #[launch]
 * Grammar: Rust (tree-sitter-rust).
 */

const { ENTRY_WEIGHT } = require('../../../../utils/project-context');

const QUERY = `
[
  (identifier) @id
  (scoped_identifier) @scoped_id
]
`;

function postProcess(matches) {
  if (!matches || matches.length === 0) return null;
  let hasRocketRef = false;
  let hasLaunch = false;

  for (const match of matches) {
    const id = match.id?.text;
    const scoped = match.scoped_id?.text;

    if (id === 'rocket') {
      hasRocketRef = true;
    }
    if (id === 'launch') {
      hasLaunch = true;
    }
    if (scoped && scoped.includes('rocket')) {
      hasRocketRef = true;
    }
  }

  if (hasRocketRef || hasLaunch) {
    return {
      framework: 'rocket',
      reason: 'rocket-attribute',
      isEntry: true,
      entryPointWeight: ENTRY_WEIGHT.HIGH,
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
