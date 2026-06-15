/**
 * Actix-web framework detection query — tree-sitter query for content-based detection.
 * Matches: #[get(...)] / #[post(...)] / #[actix_web::main] / #[actix_rt::main]
 * Grammar: Rust (tree-sitter-rust).
 */

const QUERY = `
[
  (identifier) @id
  (scoped_identifier) @scoped_id
]
`;

function postProcess(matches) {
  if (!matches || matches.length === 0) return null;
  let hasActixRef = false;
  let hasRocketRef = false;
  let hasGenericAttr = false;

  for (const match of matches) {
    const id = match.id?.text;
    const scoped = match.scoped_id?.text;

    if (id === 'actix_web') {
      hasActixRef = true;
    }
    if (id === 'rocket') {
      hasRocketRef = true;
    }
    if (id && /^(get|post|put|delete|patch)$/.test(id)) {
      hasGenericAttr = true;
    }
    if (scoped && scoped.includes('actix_web')) {
      hasActixRef = true;
    }
  }

  if (hasRocketRef) {
    return null;
  }

  if (hasActixRef || hasGenericAttr) {
    return {
      framework: 'actix-web',
      reason: 'actix-attribute',
      isEntry: true,
      entryPointWeight: 3.0,
    };
  }
  return null;
}

module.exports = {
  language: 'rust',
  framework: 'actix-web',
  purpose: 'framework-detection',
  query: QUERY,
  postProcess,
};
