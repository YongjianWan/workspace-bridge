// @contract — Fiber route extraction: query path captures App/Router route methods
const assert = require('assert');
const frameworkPatterns = require('../src/services/dep-graph/framework-patterns');
const { clearQueryCache } = require('../src/services/dep-graph/query-compiler');
const { patchExtractRoutesWithQuery } = require('./test-helpers');
const fiberQuery = require('../src/services/dep-graph/queries/route-extraction/go-fiber');

patchExtractRoutesWithQuery(frameworkPatterns, fiberQuery, '.go');

async function testFiberBasicRoutes() {
  const content = `
package routes

func setup(app *fiber.App) {
  app.Get("/users", getUsers)
  app.Post("/users", createUser)
  app.Put("/users/:id", updateUser)
  app.Delete("/users/:id", deleteUser)
  app.Patch("/users/:id", patchUser)
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

async function testFiberQueryExtractsFrameworkName() {
  const content = `
package main

func register(app *fiber.App) {
  app.Get("/api/items", getItems)
  app.Post("/api/items", createItem)
}
`;

  const routes = await frameworkPatterns.extractRoutes('/project/app.go', content);
  assert(routes.length >= 2, `expected at least 2 routes, got ${routes.length}`);
  assert(routes.every((r) => r.framework === 'fiber'), 'every route should report framework fiber');
  assert(routes.some((r) => r.method === 'GET' && r.path === '/api/items'), 'should extract GET /api/items');
  assert(routes.some((r) => r.method === 'POST' && r.path === '/api/items'), 'should extract POST /api/items');
}

async function testFiberLargeFileDeepRoutes() {
  const prefix = Array(400).fill("// filler line to push routes past the 16384 byte scan limit\n").join('');
  const suffix = `
func deep(app *fiber.App) {
  app.Get("/deep-route-1", handler1)
  app.Post("/deep-route-2", handler2)
  app.Put("/deep-route-3", handler3)
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

async function testFiberDedupe() {
  const content = `
package main

func dup(app *fiber.App) {
  app.Get("/users", handler1)
  app.Get("/users", handler2)
}
`;
  const routes = await frameworkPatterns.extractRoutes('/project/dup.go', content);
  assert.strictEqual(routes.length, 1, 'should dedupe identical routes');
  assert.strictEqual(routes[0].method, 'GET');
  assert.strictEqual(routes[0].path, '/users');
}

async function testFiberRawStringRoute() {
  const content = `
package main

func raw(app *fiber.App) {
  app.Get(` + '`/raw`' + `, handler)
}
`;
  const routes = await frameworkPatterns.extractRoutes('/project/raw.go', content);
  const paths = routes.map((r) => `${r.method}:${r.path}`);
  assert(paths.includes('GET:/raw'), 'should extract route from raw string literal');
}

async function testNonFiberFileReturnsEmpty() {
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
  await testFiberBasicRoutes();
  await testFiberQueryExtractsFrameworkName();
  await testFiberLargeFileDeepRoutes();
  await testFiberDedupe();
  await testFiberRawStringRoute();
  await testNonFiberFileReturnsEmpty();
  console.log('PASS: wave15-fiber-query-test');
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
