// @contract — FastAPI route extraction: query semantics + extractRoutes equivalence
const assert = require('assert');
const { extractRoutes } = require('../src/services/dep-graph/framework-patterns');
const { compileQuery, runQuery } = require('../src/services/dep-graph/query-compiler');
const { getParserModule, loadLanguage } = require('../src/services/dep-graph/parsers/tree-sitter');
const fastapiQuery = require('../src/services/dep-graph/queries/route-extraction/py-fastapi');

async function runQueryRoutes(queryModule, content) {
  const mod = await getParserModule();
  if (!mod) throw new Error('tree-sitter WASM unavailable');
  const lang = await loadLanguage(queryModule.language);
  if (!lang) throw new Error(`language ${queryModule.language} unavailable`);

  const parser = new mod.Parser();
  parser.setLanguage(lang);
  const tree = parser.parse(content);

  const compiled = await compileQuery(queryModule.language, queryModule.query);
  if (!compiled) throw new Error('query compilation failed');

  const matches = runQuery(tree, compiled);
  const routes = queryModule.postProcess(matches || []);

  tree.delete();
  parser.delete();
  return routes;
}

async function testFastApiBasicRoutesViaExtractRoutes() {
  const content = `
@app.get('/users')
def list_users(): pass

@app.post('/users')
def create_user(): pass

@router.put('/users/:id')
def update_user(): pass

@router.delete('/users/:id')
def delete_user(): pass

@app.patch('/users/:id')
def patch_user(): pass
`;
  const routes = await extractRoutes('/project/routes.py', content);
  const paths = routes.map((r) => `${r.method}:${r.path}`);
  assert(paths.includes('GET:/users'), 'should extract GET /users');
  assert(paths.includes('POST:/users'), 'should extract POST /users');
  assert(paths.includes('PUT:/users/:id'), 'should extract PUT /users/:id');
  assert(paths.includes('DELETE:/users/:id'), 'should extract DELETE /users/:id');
  assert(paths.includes('PATCH:/users/:id'), 'should extract PATCH /users/:id');
}

async function testFastApiQueryMatchesRegexFallback() {
  const content = `
from fastapi import FastAPI
app = FastAPI()

@app.get('/api/items')
def get_items(): pass

@app.post('/api/items')
def create_item(): pass
`;
  const queryRoutes = await runQueryRoutes(fastapiQuery, content);
  const regexRoutes = await extractRoutes('/project/app.py', content);

  assert(queryRoutes.length >= 2, `query should find at least 2 routes, got ${queryRoutes.length}`);
  assert.strictEqual(queryRoutes[0].framework, 'fastapi');
  assert.strictEqual(queryRoutes[0].method, 'GET');
  assert.strictEqual(queryRoutes[0].path, '/api/items');

  const queryPaths = queryRoutes.map((r) => `${r.method}:${r.path}`);
  const regexPaths = regexRoutes.map((r) => `${r.method}:${r.path}`);
  assert(queryPaths.includes('GET:/api/items'), 'query should extract GET /api/items');
  assert(queryPaths.includes('POST:/api/items'), 'query should extract POST /api/items');
  assert(regexPaths.includes('GET:/api/items'), 'regex fallback should extract GET /api/items');
}

async function testFastApiQueryFindsDeepRoutes() {
  // Build a file larger than 16384 bytes with routes past the regex scan limit.
  const prefix = Array(400).fill("# filler line to push routes past the 16384 byte scan limit\n").join('');
  const suffix = `
@app.get('/deep-route-1')
def handler1(): pass

@app.post('/deep-route-2')
def handler2(): pass

@router.delete('/deep-route-3')
def handler3(): pass
`;
  const content = prefix + suffix;
  assert(content.length > 16384, 'test content should exceed 16384 bytes');

  const routes = await runQueryRoutes(fastapiQuery, content);
  const paths = routes.map((r) => r.path);
  assert(paths.includes('/deep-route-1'), 'query should find route past 16384 bytes');
  assert(paths.includes('/deep-route-2'), 'query should find route past 16384 bytes');
  assert(paths.includes('/deep-route-3'), 'query should find route past 16384 bytes');
}

async function testFastApiQueryDedupe() {
  const content = `
@app.get('/users')
def handler1(): pass

@app.get('/users')
def handler2(): pass
`;
  const routes = await runQueryRoutes(fastapiQuery, content);
  assert.strictEqual(routes.length, 1, 'should dedupe identical routes');
  assert.strictEqual(routes[0].method, 'GET');
  assert.strictEqual(routes[0].path, '/users');
}

async function testFlaskRouteNotMatchedByFastApiQuery() {
  const content = `
@app.route('/legacy')
def legacy(): pass
`;
  const routes = await runQueryRoutes(fastapiQuery, content);
  assert.strictEqual(routes.length, 0, 'Flask @app.route should not match FastAPI query');
}

async function testNonPythonFileReturnsEmpty() {
  const routes = await extractRoutes('/project/main.go', 'func helper() {}');
  assert.strictEqual(routes.length, 0, 'Go file should have no Python routes');
}

async function main() {
  await testFastApiBasicRoutesViaExtractRoutes();
  await testFastApiQueryMatchesRegexFallback();
  await testFastApiQueryFindsDeepRoutes();
  await testFastApiQueryDedupe();
  await testFlaskRouteNotMatchedByFastApiQuery();
  await testNonPythonFileReturnsEmpty();
  console.log('PASS: wave15-fastapi-query-test');
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
