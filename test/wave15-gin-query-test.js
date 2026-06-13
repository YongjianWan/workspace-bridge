// @contract — Gin route extraction: query path vs regex fallback equivalence
const assert = require('assert');
const frameworkPatterns = require('../src/services/dep-graph/framework-patterns');
const { clearQueryCache } = require('../src/services/dep-graph/query-compiler');
const { patchExtractRoutesWithQuery } = require('./test-helpers');
const ginQuery = require('../src/services/dep-graph/queries/route-extraction/go-gin');

patchExtractRoutesWithQuery(frameworkPatterns, ginQuery, '.go');

async function testGinBasicRoutes() {
  const content = `
package routes

func setup(r *gin.Engine) {
  r.GET("/users", getUsers)
  r.POST("/users", createUser)
  router.PUT("/users/:id", updateUser)
  router.DELETE("/users/:id", deleteUser)
  r.PATCH("/users/:id", patchUser)
}
`;

  const routes = await frameworkPatterns.extractRoutes('/project/routes.go', content);
  assert(routes.length >= 5, `expected at least 5 routes, got ${routes.length}`);

  const paths = routes.map((r) => `${r.method}:${r.path}`);
  assert(paths.includes('GET:/users'), 'should extract GET /users');
  assert(paths.includes('POST:/users'), 'should extract POST /users');
  assert(paths.includes('PUT:/users/:id'), 'should extract PUT /users/:id');
  assert(paths.includes('DELETE:/users/:id'), 'should extract DELETE /users/:id');
  assert(paths.includes('PATCH:/users/:id'), 'should extract PATCH /users/:id');
}

async function testGinQueryMatchesRegex() {
  const content = `
package main

func register(r *gin.Engine) {
  r.GET("/api/items", getItems)
  r.POST("/api/items", createItem)
}
`;

  const routes = await frameworkPatterns.extractRoutes('/project/app.go', content);
  assert.strictEqual(routes.length, 2, 'should extract 2 routes');
  assert.strictEqual(routes[0].method, 'GET');
  assert.strictEqual(routes[0].path, '/api/items');
  assert.strictEqual(routes[0].framework, 'gin');
  assert.strictEqual(routes[1].method, 'POST');
  assert.strictEqual(routes[1].path, '/api/items');
}

async function testGinLargeFileDeepRoutes() {
  const prefix = Array(400).fill("// filler line to push routes past the 16384 byte scan limit\n").join('');
  const suffix = `
func deep(r *gin.Engine) {
  r.GET("/deep-route-1", handler1)
  r.POST("/deep-route-2", handler2)
  router.PUT("/deep-route-3", handler3)
}
`;
  const content = `package deep\n\n` + prefix + suffix;
  assert(content.length > 16384, 'test content should exceed 16384 bytes');

  const routes = await frameworkPatterns.extractRoutes('/project/large-routes.go', content);

  const paths = routes.map((r) => r.path);
  assert(paths.includes('/deep-route-1'), 'query should find route past 16384 bytes');
  assert(paths.includes('/deep-route-2'), 'query should find route past 16384 bytes');
  assert(paths.includes('/deep-route-3'), 'query should find route past 16384 bytes');
}

async function testGinDedupe() {
  const content = `
package main

func dup(r *gin.Engine) {
  r.GET("/users", handler1)
  r.GET("/users", handler2)
}
`;
  const routes = await frameworkPatterns.extractRoutes('/project/dup.go', content);
  assert.strictEqual(routes.length, 1, 'should dedupe identical routes');
  assert.strictEqual(routes[0].method, 'GET');
  assert.strictEqual(routes[0].path, '/users');
}

async function testGinRawStringRoute() {
  const content = `
package main

func raw(r *gin.Engine) {
  r.GET(` + '`/raw`' + `, handler)
}
`;
  const routes = await frameworkPatterns.extractRoutes('/project/raw.go', content);
  const paths = routes.map((r) => `${r.method}:${r.path}`);
  assert(paths.includes('GET:/raw'), 'should extract route from raw string literal');
}

async function testGinRegexFallbackDoubleQuotes() {
  // Intentionally malformed Go syntax forces tree-sitter query to return null,
  // so extractRoutes falls back to the ROUTE_PATTERNS.go regex.
  // This is a regression guard for the `[^"']` character class in the Gin regex.
  const content = `r.GET("/api/users", handler)`;
  const routes = await frameworkPatterns.extractRoutes('/project/fallback.go', content);
  assert.strictEqual(routes.length, 1, 'regex fallback should extract one route');
  assert.strictEqual(routes[0].method, 'GET');
  assert.strictEqual(routes[0].path, '/api/users', 'regex fallback should not include trailing quote');
  assert.strictEqual(routes[0].framework, 'gin');
}

async function testNonGinFileReturnsEmpty() {
  const content = `
package main

func add(a, b int) int {
  return a + b
}
`;
  const routes = await frameworkPatterns.extractRoutes('/project/utils.go', content);
  assert.strictEqual(routes.length, 0, 'plain Go file should have no routes');
}

async function main() {
  clearQueryCache();
  await testGinBasicRoutes();
  await testGinQueryMatchesRegex();
  await testGinLargeFileDeepRoutes();
  await testGinDedupe();
  await testGinRawStringRoute();
  await testGinRegexFallbackDoubleQuotes();
  await testNonGinFileReturnsEmpty();
  console.log('PASS: wave15-gin-query-test');
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
