// @contract — Axum route extraction: builder-style route registration
const assert = require('assert');
const { compileQuery, runQuery, clearQueryCache } = require('../src/services/dep-graph/query-compiler');
const {
  getParserModule,
  loadLanguage,
} = require('../src/services/dep-graph/parsers/tree-sitter');
const axumQuery = require('../src/services/dep-graph/queries/route-extraction/rs-axum');

async function runAxumQuery(content) {
  const mod = await getParserModule();
  const lang = await loadLanguage('rust');
  const parser = new mod.Parser();
  parser.setLanguage(lang);
  const tree = parser.parse(content);

  const compiled = await compileQuery('rust', axumQuery.query);
  if (!compiled) throw new Error('failed to compile Axum query');

  const matches = runQuery(tree, compiled);
  const routes = axumQuery.postProcess(matches);

  tree.delete();
  parser.delete();
  return routes;
}

async function testAxumBasicRoutes() {
  const content = `
Router::new()
  .route("/users", get(list_users))
  .route("/users", post(create_user))
  .route("/users/:id", put(update_user))
  .route("/users/:id", delete(delete_user))
  .route("/users/:id", patch(patch_user));
  `;

  const routes = await runAxumQuery(content);
  assert(routes.length >= 5, `expected at least 5 routes, got ${routes.length}`);

  const paths = routes.map((r) => `${r.method}:${r.path}`);
  assert(paths.includes('GET:/users'), 'should extract GET /users');
  assert(paths.includes('POST:/users'), 'should extract POST /users');
  assert(paths.includes('PUT:/users/:id'), 'should extract PUT /users/:id');
  assert(paths.includes('DELETE:/users/:id'), 'should extract DELETE /users/:id');
  assert(paths.includes('PATCH:/users/:id'), 'should extract PATCH /users/:id');
  assert(routes.every((r) => r.framework === 'axum'), 'all routes should be axum');
}

async function testAxumScopedMethod() {
  const content = `
let app = Router::new().route("/health", routing::get(health_check));
  `;

  const routes = await runAxumQuery(content);
  assert.strictEqual(routes.length, 1, 'should extract scoped routing::get route');
  assert.strictEqual(routes[0].method, 'GET');
  assert.strictEqual(routes[0].path, '/health');
  assert.strictEqual(routes[0].framework, 'axum');
}

async function testAxumIgnoresNonRouteBuilderMethods() {
  const content = `
let app = Router::new()
  .layer(tower::TraceLayer::new_for_http())
  .fallback(handler);
  `;

  const routes = await runAxumQuery(content);
  assert.strictEqual(routes.length, 0, 'should ignore layer and fallback builders');
}

async function testAxumDedupe() {
  const content = `
Router::new()
  .route("/users", get(handler_a))
  .route("/users", get(handler_b));
  `;

  const routes = await runAxumQuery(content);
  assert.strictEqual(routes.length, 1, 'should dedupe identical routes');
  assert.strictEqual(routes[0].method, 'GET');
  assert.strictEqual(routes[0].path, '/users');
}

async function testAxumQueryPastRegexScanLimit() {
  // The regex fallback does not support Axum, but once this query is registered
  // the tree-sitter path must find routes regardless of their position in file.
  const prefix = Array(400).fill('// filler line to push routes past the 16384 byte scan limit\n').join('');
  const suffix = `
Router::new()
  .route("/deep-route-1", get(handler1))
  .route("/deep-route-2", post(handler2));
  `;
  const content = prefix + suffix;
  assert(content.length > 16384, 'test content should exceed 16384 bytes');

  const routes = await runAxumQuery(content);
  const paths = routes.map((r) => r.path);
  assert(paths.includes('/deep-route-1'), 'query should find route past 16384 bytes');
  assert(paths.includes('/deep-route-2'), 'query should find route past 16384 bytes');
}

async function main() {
  try {
    await testAxumBasicRoutes();
    await testAxumScopedMethod();
    await testAxumIgnoresNonRouteBuilderMethods();
    await testAxumDedupe();
    await testAxumQueryPastRegexScanLimit();
    console.log('PASS: wave15-axum-query-test');
  } finally {
    clearQueryCache();
  }
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
