// @contract — Actix-web route extraction: query semantics for attribute-macro routes
const assert = require('assert');
const { extractRoutes } = require('../src/services/dep-graph/framework-patterns');
const { compileQuery, runQuery, clearQueryCache } = require('../src/services/dep-graph/query-compiler');
const {
  getParserModule,
  loadLanguage,
} = require('../src/services/dep-graph/parsers/tree-sitter');
const actixQuery = require('../src/services/dep-graph/queries/route-extraction/rs-actix');

async function runActixQuery(content) {
  const mod = await getParserModule();
  const lang = await loadLanguage('rust');
  const parser = new mod.Parser();
  parser.setLanguage(lang);
  const tree = parser.parse(content);

  const compiled = await compileQuery('rust', actixQuery.query);
  if (!compiled) throw new Error('failed to compile Actix query');

  const matches = runQuery(tree, compiled);
  const routes = actixQuery.postProcess(matches);

  tree.delete();
  parser.delete();
  return routes;
}

async function testActixQueryBasicRoutes() {
  const content = `
#[get("/users")]
async fn list_users() -> impl Responder {}

#[post("/users")]
async fn create_user() -> impl Responder {}

#[actix_web::put("/users/:id")]
async fn update_user() -> impl Responder {}

#[delete("/users/:id")]
async fn delete_user() -> impl Responder {}

#[patch("/users/:id")]
async fn patch_user() -> impl Responder {}
  `;

  const routes = await runActixQuery(content);
  assert(routes.length >= 5, `expected at least 5 routes, got ${routes.length}`);

  const paths = routes.map((r) => `${r.method}:${r.path}`);
  assert(paths.includes('GET:/users'), 'should extract GET /users');
  assert(paths.includes('POST:/users'), 'should extract POST /users');
  assert(paths.includes('PUT:/users/:id'), 'should extract PUT /users/:id');
  assert(paths.includes('DELETE:/users/:id'), 'should extract DELETE /users/:id');
  assert(paths.includes('PATCH:/users/:id'), 'should extract PATCH /users/:id');
  assert(routes.every((r) => r.framework === 'actix-web'), 'all routes should be actix-web');
}

async function testActixQueryIgnoresNonRouteAttributes() {
  const content = `
#[derive(Debug)]
struct User { id: u64 }

#[get("/users")]
async fn list_users() -> impl Responder {}
  `;

  const routes = await runActixQuery(content);
  assert.strictEqual(routes.length, 1, 'should ignore derive and only extract route');
  assert.strictEqual(routes[0].method, 'GET');
  assert.strictEqual(routes[0].path, '/users');
}

async function testActixQueryDedupe() {
  const content = `
#[get("/users")]
async fn a() -> impl Responder {}

#[get("/users")]
async fn b() -> impl Responder {}
  `;

  const routes = await runActixQuery(content);
  assert.strictEqual(routes.length, 1, 'should dedupe identical routes');
  assert.strictEqual(routes[0].method, 'GET');
  assert.strictEqual(routes[0].path, '/users');
}

async function testNonRustFileReturnsEmpty() {
  const content = 'function add(a, b) { return a + b; }';
  const routes = await extractRoutes('/project/utils.js', content);
  assert.strictEqual(routes.length, 0, 'JS file should have no Rust routes');
}

async function main() {
  try {
    await testActixQueryBasicRoutes();
    await testActixQueryIgnoresNonRouteAttributes();
    await testActixQueryDedupe();
    await testNonRustFileReturnsEmpty();
    console.log('PASS: wave15-actix-query-test');
  } finally {
    clearQueryCache();
  }
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
