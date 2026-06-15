/**
 * Svelte framework detection query — tree-sitter query for content-based detection.
 * Matches: import from 'svelte' or '@sveltejs/kit'
 * Grammar: TypeScript (tree-sitter-typescript).
 */

const QUERY = `
(import_statement source: (string) @source)
`;

function postProcess(matches) {
  if (!matches || matches.length === 0) return null;
  for (const match of matches) {
    const source = match.source?.text;
    if (source && /['"](@sveltejs\/kit|svelte)['"]/.test(source)) {
      const isKit = source.includes('@sveltejs/kit');
      return {
        framework: isKit ? 'sveltekit' : 'svelte',
        reason: isKit ? 'sveltekit-import' : 'svelte-import',
        isEntry: false,
      };
    }
  }
  return null;
}

module.exports = {
  language: 'typescript',
  framework: 'svelte',
  purpose: 'framework-detection',
  query: QUERY,
  postProcess,
};
