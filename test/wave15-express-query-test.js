// @contract — Express route extraction: query path vs regex fallback equivalence
const assert = require('assert');
const { extractRoutes } = require('../src/services/dep-graph/framework-patterns');

async function testExpressBasicRoutes() {
  const content = `
    app.get('/users', getUsers);
    app.post('/users', createUser);
    router.put('/users/:id', updateUser);
    router.delete('/users/:id', deleteUser);
    app.patch('/users/:id', patchUser);
    app.all('/health', healthCheck);
  `;

  const routes = await extractRoutes('/project/routes.js', content);
  assert(routes.length >= 6, `expected at least 6 routes, got ${routes.length}`);

  const paths = routes.map((r) => `${r.method}:${r.path}`);
  assert(paths.includes('GET:/users'), 'should extract GET /users');
  assert(paths.includes('POST:/users'), 'should extract POST /users');
  assert(paths.includes('PUT:/users/:id'), 'should extract PUT /users/:id');
  assert(paths.includes('DELETE:/users/:id'), 'should extract DELETE /users/:id');
  assert(paths.includes('PATCH:/users/:id'), 'should extract PATCH /users/:id');
  assert(paths.includes('ALL:/health'), 'should extract ALL /health');
}

async function testExpressQueryMatchesRegex() {
  const content = `
    const express = require('express');
    const app = express();
    app.get('/api/items', (req, res) => {});
    app.post('/api/items', (req, res) => {});
    module.exports = app;
  `;

  // Query path should return same routes as regex would
  const routes = await extractRoutes('/project/app.js', content);
  assert.strictEqual(routes.length, 2, 'should extract 2 routes');
  assert.strictEqual(routes[0].method, 'GET');
  assert.strictEqual(routes[0].path, '/api/items');
  assert.strictEqual(routes[0].framework, 'express');
  assert.strictEqual(routes[1].method, 'POST');
  assert.strictEqual(routes[1].path, '/api/items');
}

async function testExpressLargeFileDeepRoutes() {
  // Build a file larger than 16384 bytes with routes deep in the file
  const prefix = Array(400).fill("// filler line to push routes past the 16384 byte scan limit\n").join('');
  const suffix = `
    app.get('/deep-route-1', handler1);
    app.post('/deep-route-2', handler2);
    router.put('/deep-route-3', handler3);
  `;
  const content = prefix + suffix;
  assert(content.length > 16384, 'test content should exceed 16384 bytes');

  const routes = await extractRoutes('/project/large-routes.js', content);

  // Regex fallback would miss these because they are past the scan limit.
  // Query path should find them regardless of position.
  const paths = routes.map((r) => r.path);
  assert(paths.includes('/deep-route-1'), 'query should find route past 16384 bytes');
  assert(paths.includes('/deep-route-2'), 'query should find route past 16384 bytes');
  assert(paths.includes('/deep-route-3'), 'query should find route past 16384 bytes');
}

async function testExpressDedupe() {
  const content = `
    app.get('/users', handler1);
    app.get('/users', handler2);
  `;
  const routes = await extractRoutes('/project/dup.js', content);
  assert.strictEqual(routes.length, 1, 'should dedupe identical routes');
  assert.strictEqual(routes[0].method, 'GET');
  assert.strictEqual(routes[0].path, '/users');
}

async function testNonExpressFileReturnsEmpty() {
  const content = 'function add(a, b) { return a + b; }';
  const routes = await extractRoutes('/project/utils.js', content);
  assert.strictEqual(routes.length, 0, 'plain JS file should have no routes');
}

async function testNonJsFileReturnsEmpty() {
  const content = 'def hello(): pass';
  const routes = await extractRoutes('/project/app.py', content);
  // Phase 2: Python falls back to regex (no query yet), regex should not match
  assert.strictEqual(routes.length, 0, 'Python file should have no Express routes');
}

async function main() {
  await testExpressBasicRoutes();
  await testExpressQueryMatchesRegex();
  await testExpressLargeFileDeepRoutes();
  await testExpressDedupe();
  await testNonExpressFileReturnsEmpty();
  await testNonJsFileReturnsEmpty();
  console.log('PASS: wave15-express-query-test');
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
