#!/usr/bin/env node
// @semantic
/**
 * Test direct SQLite-backed affected HTTP route query and persistence.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const assert = require('assert');
const { runCliInProcess, cleanupTempDir } = require('./test-helpers');
const { ServiceContainer } = require('../src/services/container');

async function main() {
  const testDir = path.join(os.tmpdir(), 'wb-test-gf-http-routes-db-' + crypto.randomBytes(4).toString('hex'));
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }

  // 1. Initialize project structures
  fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify({ name: 'gf-http-routes-db-test', version: '1.0.0' }, null, 2));

  // Dependency graph: app.js -> route.js -> service.js -> db.js
  const appFile = path.join(testDir, 'app.js');
  const routeFile = path.join(testDir, 'route.js');
  const serviceFile = path.join(testDir, 'service.js');
  const dbFile = path.join(testDir, 'db.js');

  fs.writeFileSync(appFile, `const r = require('./route');`);
  fs.writeFileSync(routeFile, `
    const express = require('express');
    const router = express.Router();
    const s = require('./service');
    router.get('/api/users', (req, res) => res.json(s.getUsers()));
    router.post('/api/users/create', (req, res) => res.json(s.createUser()));
    module.exports = router;
  `);
  fs.writeFileSync(serviceFile, `
    const db = require('./db');
    module.exports = { getUsers: () => db.query(), createUser: () => db.save() };
  `);
  fs.writeFileSync(dbFile, `module.exports = { query: () => [], save: () => true };`);

  try {
    // 2. Cold build
    const container = new ServiceContainer({ quiet: true });
    await container.initialize(testDir, 30000, { watch: false });

    const depGraph = container.snapshot.graph._dg;
    assert.ok(depGraph, 'DependencyGraph should be initialized');

    // Verify that the 'routes' table contains the persisted routes in SQLite
    const dbRoutes = container.cache.loadRoutes();
    assert.ok(dbRoutes, 'loadRoutes should return rows from database');
    assert.strictEqual(dbRoutes.length, 2, 'Should persist exactly 2 routes in SQLite routes table');
    
    const sortedPaths = dbRoutes.map(r => r.path).sort();
    assert.deepStrictEqual(sortedPaths, ['/api/users', '/api/users/create'], 'Persisted route paths in SQLite table mismatch');

    // 3. Verify that findAffectedHttpRoutes uses the SQLite database query path.
    // To prove it is using the database rather than in-memory BFS fallback:
    // We temporarily clear the 'routes' property of the in-memory route node.
    const routeKey = depGraph.normalizeFilePath(routeFile);
    const inMemoryNode = depGraph.graph.get(routeKey);
    const originalRoutes = inMemoryNode.routes;
    inMemoryNode.routes = []; // Clear in-memory routes

    // Query affected HTTP routes from dbFile. Since in-memory routes are cleared,
    // if it returned results, they MUST have come from the SQLite database!
    const affectedHttpRoutes = depGraph.findAffectedHttpRoutes(dbFile, 3);
    assert.strictEqual(affectedHttpRoutes.length, 2, 'Should query 2 routes from SQLite even when in-memory node is cleared');
    assert.ok(affectedHttpRoutes.some(r => r.path === '/api/users'), 'SQLite: /api/users route should be returned');
    assert.ok(affectedHttpRoutes.some(r => r.path === '/api/users/create'), 'SQLite: /api/users/create route should be returned');

    // Restore in-memory routes
    inMemoryNode.routes = originalRoutes;

    // 4. Verify Fallback path (BFS in-memory fallback when cache is not available)
    const originalCache = depGraph.cache;
    depGraph.cache = null; // Remove cache to force in-memory BFS path
    const fallbackRoutes = depGraph.findAffectedHttpRoutes(dbFile, 3);
    assert.strictEqual(fallbackRoutes.length, 2, 'In-memory fallback: should find 2 routes');
    assert.ok(fallbackRoutes.some(r => r.path === '/api/users'), 'In-memory fallback: /api/users route should be returned');
    depGraph.cache = originalCache; // Restore cache

    // 5. Incremental Updates: modify route.js to change routes
    fs.writeFileSync(routeFile, `
      const express = require('express');
      const router = express.Router();
      const s = require('./service');
      router.get('/api/users/update', (req, res) => res.json(s.updateUser()));
      module.exports = router;
    `);

    // Modify mtime to force rebuild
    container.cache.setFileMetadata(routeFile, { mtime: Date.now(), size: fs.statSync(routeFile).size });
    await depGraph.updateFiles([routeFile]);

    // Verify database has been updated
    const updatedDbRoutes = container.cache.loadRoutes();
    assert.strictEqual(updatedDbRoutes.length, 1, 'Incremental update: DB routes count should be 1');
    assert.strictEqual(updatedDbRoutes[0].path, '/api/users/update', 'Incremental update: DB route path mismatch');

    const updatedAffected = depGraph.findAffectedHttpRoutes(dbFile, 3);
    assert.strictEqual(updatedAffected.length, 1, 'Incremental update: affected routes count mismatch');
    assert.strictEqual(updatedAffected[0].path, '/api/users/update', 'Incremental update: affected route path mismatch');

    console.log('PASS: graph-first-http-routes-db-test');
  } finally {
    cleanupTempDir(testDir);
  }
}

main().catch(err => {
  console.error('FAIL: graph-first-http-routes-db-test failed:', err);
  process.exit(1);
});
