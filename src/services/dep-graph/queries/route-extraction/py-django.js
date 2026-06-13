/**
 * Django route extraction query — tree-sitter query for URLconf declarations.
 *
 * Matches: urlpatterns = [path('users/', views.users), re_path(r'^...$', view)]
 * Ignores: other list assignments and non-route call entries.
 * Grammar: Python (tree-sitter-python).
 */

const QUERY = `
(assignment
  left: (identifier) @name
  right: (list
    (call
      function: (identifier) @fn
      arguments: (argument_list
        . (string) @route
      )
    )
  )
)
`;

// Django URLconf only uses these two call names for route strings.
const VALID_FUNCTIONS = new Set(['path', 're_path']);

/**
 * Strip Python string prefixes (r/u/f/b) and surrounding quotes.
 * Django regex routes are commonly written as r'^pattern/$'.
 */
function stripPythonString(text) {
  if (!text) return '';
  const m = text.match(/^([rRuUfFbB]+)?(['"])/);
  if (!m) return text.trim();

  const prefixLen = m[1] ? m[1].length : 0;
  const quote = m[2];
  if (text.startsWith(quote.repeat(3), prefixLen)) {
    return text.slice(prefixLen + quote.length * 3, -quote.length * 3);
  }
  return text.slice(prefixLen + 1, -1);
}

function postProcess(matches) {
  const routes = [];
  const seen = new Set();

  for (const capture of matches) {
    const name = capture.name?.text;
    const fnName = capture.fn?.text;
    const routeText = capture.route?.text || '';

    if (name !== 'urlpatterns') continue;
    if (!VALID_FUNCTIONS.has(fnName)) continue;

    const routePath = stripPythonString(routeText);
    if (!routePath) continue;

    const dedup = `ALL:${routePath}`;
    if (seen.has(dedup)) continue;
    seen.add(dedup);

    routes.push({
      method: 'ALL',
      path: routePath,
      framework: 'django',
      handler: null,
    });
  }

  return routes;
}

module.exports = {
  language: 'python',
  framework: 'django',
  purpose: 'route-extraction',
  query: QUERY,
  postProcess,
};
