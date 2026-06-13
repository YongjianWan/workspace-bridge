/**
 * SvelteKit route extraction query — tree-sitter query for server routes.
 *
 * Matches HTTP method exports in +server.ts / +page.server.ts files:
 *   export const GET = ...
 *   export const POST = ...
 *   export function GET() {}
 *
 * SvelteKit routes are file-system based; the actual URL path is derived from
 * the directory layout (+server.ts / +page.svelte), not from file content. We
 * emit an empty path as a marker and rely on the HTTP method for impact
 * signalling.
 *
 * Grammar: TypeScript (tree-sitter-typescript).
 */

const QUERY = `
[
  (export_statement
    declaration: (lexical_declaration
      (variable_declarator
        name: (identifier) @method
      )
    )
  )
  (export_statement
    declaration: (function_declaration
      name: (identifier) @method
    )
  )
]
`;

// SvelteKit +server.ts supports the standard HTTP methods as named exports.
const VALID_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']);

function postProcess(matches) {
  const routes = [];
  const seen = new Set();

  for (const capture of matches) {
    const methodRaw = capture.method?.text;
    if (!VALID_METHODS.has(methodRaw)) continue;

    const method = methodRaw.toUpperCase();
    // Path is directory-layout derived; content only reveals handled methods.
    const routePath = '';
    const dedup = `${method}:${routePath}`;
    if (seen.has(dedup)) continue;
    seen.add(dedup);

    routes.push({
      method,
      path: routePath,
      framework: 'sveltekit',
      handler: null,
    });
  }

  return routes;
}

module.exports = {
  language: 'typescript',
  framework: 'sveltekit',
  purpose: 'route-extraction',
  query: QUERY,
  postProcess,
};
