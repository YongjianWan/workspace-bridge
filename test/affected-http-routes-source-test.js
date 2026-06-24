#!/usr/bin/env node
// @semantic
/**
 * Verify that findAffectedHttpRoutes tags each route with source: 'src' | 'test'.
 * Covers both the SQLite fast path and the in-memory BFS fallback.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const assert = require('assert');
const { cleanupTempDir } = require('./test-helpers');
const { ServiceContainer } = require('../src/services/container');

async function main() {
  const testDir = path.join(os.tmpdir(), 'wb-test-http-routes-source-' + crypto.randomBytes(4).toString('hex'));
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }

  fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify({ name: 'http-routes-source-test', version: '1.0.0' }, null, 2));

  // Dependency graph:
  //   app.js -> route.js -> service.js -> db.js
  //   app.test.js -> route.test.js -> db.js
  const appFile = path.join(testDir, 'app.js');
  const routeFile = path.join(testDir, 'route.js');
  const routeTestFile = path.join(testDir, 'route.test.js');
  const serviceFile = path.join(testDir, 'service.js');
  const dbFile = path.join(testDir, 'db.js');

  fs.writeFileSync(appFile, `const r = require('./route');`);
  fs.writeFileSync(routeFile, `
    const express = require('express');
    const router = express.Router();
    const s = require('./service');
    router.get('/api/users', (req, res) => res.json(s.getUsers()));
    module.exports = router;
  `);
  fs.writeFileSync(routeTestFile, `
    const express = require('express');
    const router = express.Router();
    const db = require('./db');
    router.get('/api/test-users', (req, res) => res.json(db.query()));
    module.exports = router;
  `);
  fs.writeFileSync(serviceFile, `
    const db = require('./db');
    module.exports = { getUsers: () => db.query() };
  `);
  fs.writeFileSync(dbFile, `module.exports = { query: () => [], save: () => true };`);

  try {
    const container = new ServiceContainer({ quiet: true });
    await container.initialize(testDir, 30000, { watch: false });

    const depGraph = container.snapshot.graph._dg;
    assert.ok(depGraph, 'DependencyGraph should be initialized');

    // Verify persistence picked up both source and test routes.
    const dbRoutes = container.cache.loadRoutes();
    assert.ok(dbRoutes, 'loadRoutes should return rows from database');
    assert.strictEqual(dbRoutes.length, 2, 'Should persist exactly 2 routes');

    const allRoutes = depGraph.findAffectedHttpRoutes(dbFile, 3);
    assert.strictEqual(allRoutes.length, 2, 'Should find 2 affected HTTP routes from db.js');

    const srcRoute = allRoutes.find((r) => r.path === '/api/users');
    const testRoute = allRoutes.find((r) => r.path === '/api/test-users');

    assert.ok(srcRoute, 'Source route /api/users should be present');
    assert.ok(testRoute, 'Test route /api/test-users should be present');
    assert.strictEqual(srcRoute.source, 'src', 'Production route should be tagged source: src');
    assert.strictEqual(testRoute.source, 'test', 'Test fixture route should be tagged source: test');

    // SQLite fast path: clear in-memory routes so results can only come from the DB.
    const routeKey = depGraph.normalizeFilePath(routeFile);
    const routeTestKey = depGraph.normalizeFilePath(routeTestFile);
    const originalSrcRoutes = depGraph.graph.get(routeKey).routes;
    const originalTestRoutes = depGraph.graph.get(routeTestKey).routes;
    depGraph.graph.get(routeKey).routes = [];
    depGraph.graph.get(routeTestKey).routes = [];

    const sqliteRoutes = depGraph.findAffectedHttpRoutes(dbFile, 3);
    assert.strictEqual(sqliteRoutes.length, 2, 'SQLite path should return 2 routes');
    assert.ok(sqliteRoutes.every((r) => r.source === (r.path === '/api/test-users' ? 'test' : 'src')),
      'SQLite path should tag routes with correct source');

    depGraph.graph.get(routeKey).routes = originalSrcRoutes;
    depGraph.graph.get(routeTestKey).routes = originalTestRoutes;

    // In-memory BFS fallback: remove cache to force the non-SQLite path.
    const originalCache = depGraph.cache;
    depGraph.cache = null;
    const fallbackRoutes = depGraph.findAffectedHttpRoutes(dbFile, 3);
    assert.strictEqual(fallbackRoutes.length, 2, 'In-memory fallback should return 2 routes');
    assert.ok(fallbackRoutes.every((r) => r.source === (r.path === '/api/test-users' ? 'test' : 'src')),
      'In-memory fallback should tag routes with correct source');
    depGraph.cache = originalCache;

    console.log('PASS: affected-http-routes-source-test');
  } finally {
    cleanupTempDir(testDir);
  }
}

main().catch((err) => {
  console.error('FAIL: affected-http-routes-source-test failed:', err);
  process.exit(1);
});
