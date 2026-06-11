/**
 * NestJS route extraction query — tree-sitter query for decorator-based routes.
 *
 * Matches: @Get('/path') / @Post('/path') / @Put('/path') / @Delete('/path') / @Patch('/path')
 * Ignores: @Controller('prefix') / @Get() (no argument)
 * Grammar: TypeScript (tree-sitter-typescript).
 */

const { stripQuotes } = require('../../parsers/tree-sitter');

const QUERY = `
(decorator
  (call_expression
    function: (identifier) @method
    arguments: (arguments
      . (string) @route
    )
  )
)
`;

const VALID_METHODS = new Set(['Get', 'Post', 'Put', 'Delete', 'Patch']);

function postProcess(matches) {
  const routes = [];
  const seen = new Set();

  for (const capture of matches) {
    const methodRaw = capture.method?.text;
    const routePath = stripQuotes(capture.route?.text || '');

    if (!VALID_METHODS.has(methodRaw)) continue;
    if (!routePath) continue;

    const method = methodRaw.toUpperCase();
    const dedup = `${method}:${routePath}`;
    if (seen.has(dedup)) continue;
    seen.add(dedup);

    routes.push({
      method,
      path: routePath,
      framework: 'nestjs',
      handler: null,
    });
  }

  return routes;
}

module.exports = {
  language: 'typescript',
  framework: 'nestjs',
  purpose: 'route-extraction',
  query: QUERY,
  postProcess,
};
