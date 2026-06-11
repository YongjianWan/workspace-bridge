/**
 * Spring Boot route extraction query — tree-sitter query for annotation-based routes.
 *
 * Matches: @GetMapping("/path") / @PostMapping("/path") / @RequestMapping("/path")
 * Ignores: @Override / @Autowired (no string_literal argument)
 * Grammar: Java (tree-sitter-java).
 */

const { stripQuotes } = require('../../parsers/tree-sitter');

const QUERY = `
(annotation
  name: (identifier) @method
  arguments: (annotation_argument_list
    (string_literal) @route
  )
)
`;

const VALID_METHODS = new Set([
  'GetMapping',
  'PostMapping',
  'PutMapping',
  'DeleteMapping',
  'PatchMapping',
  'RequestMapping',
]);

function postProcess(matches) {
  const routes = [];
  const seen = new Set();

  for (const capture of matches) {
    const methodRaw = capture.method?.text;
    const routePath = stripQuotes(capture.route?.text || '');

    if (!VALID_METHODS.has(methodRaw)) continue;
    if (!routePath) continue;

    let method;
    if (methodRaw === 'RequestMapping') {
      method = 'ALL';
    } else {
      method = methodRaw.replace('Mapping', '').toUpperCase();
    }

    const dedup = `${method}:${routePath}`;
    if (seen.has(dedup)) continue;
    seen.add(dedup);

    routes.push({
      method,
      path: routePath,
      framework: 'spring',
      handler: null,
    });
  }

  return routes;
}

module.exports = {
  language: 'java',
  framework: 'spring',
  purpose: 'route-extraction',
  query: QUERY,
  postProcess,
};
