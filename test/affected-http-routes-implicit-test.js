#!/usr/bin/env node
// @semantic
/**
 * Verify that findAffectedHttpRoutes sorts direct routes first, and tags
 * indirect routes reached via java-same-package or low-confidence edges.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const assert = require('assert');
const { cleanupTempDir } = require('./test-helpers');
const { ServiceContainer } = require('../src/services/container');

async function main() {
  const testDir = path.join(os.tmpdir(), 'wb-test-http-routes-implicit-' + crypto.randomBytes(4).toString('hex'));
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }

  fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify({ name: 'http-routes-implicit-test', version: '1.0.0' }, null, 2));
  fs.writeFileSync(path.join(testDir, 'pom.xml'), '<?xml version="1.0"?><project></project>');

  // Create two packages: com.example and com.other
  const pkgExampleDir = path.join(testDir, 'src/main/java/com/example');
  const pkgOtherDir = path.join(testDir, 'src/main/java/com/other');
  fs.mkdirSync(pkgExampleDir, { recursive: true });
  fs.mkdirSync(pkgOtherDir, { recursive: true });

  const controllerA = path.join(pkgExampleDir, 'ControllerA.java');
  const controllerB = path.join(pkgExampleDir, 'ControllerB.java');
  const dbFile = path.join(pkgOtherDir, 'Db.java');

  fs.writeFileSync(controllerA, `
    package com.example;
    import com.other.Db;
    import org.springframework.web.bind.annotation.GetMapping;
    import org.springframework.web.bind.annotation.RestController;
    @RestController
    public class ControllerA {
        private Db db;
        @GetMapping("/api/a")
        public String getA() { return ""; }
    }
  `);

  fs.writeFileSync(controllerB, `
    package com.example;
    import org.springframework.web.bind.annotation.GetMapping;
    import org.springframework.web.bind.annotation.RestController;
    @RestController
    public class ControllerB {
        @GetMapping("/api/b")
        public String getB() { return ""; }
    }
  `);

  fs.writeFileSync(dbFile, `
    package com.other;
    public class Db {}
  `);

  try {
    const container = new ServiceContainer({ quiet: true });
    await container.initialize(testDir, 30000, { watch: false });

    const depGraph = container.snapshot.graph._dg;
    assert.ok(depGraph, 'DependencyGraph should be initialized');

    // Querying ControllerA should return /api/a as direct
    const aRoutes = depGraph.findAffectedHttpRoutes(controllerA, 3);
    const aRoute = aRoutes.find((r) => r.path === '/api/a');
    assert.ok(aRoute);
    assert.strictEqual(aRoute.routeType, 'direct');
    assert.strictEqual(aRoute.hasImplicit, false);

    // Querying Db should return:
    // - /api/a (via ControllerA -> Db, explicit import)
    // - /api/b (via ControllerB -> ControllerA same-package relation -> Db)
    const dbRoutes = depGraph.findAffectedHttpRoutes(dbFile, 3);
    assert.ok(dbRoutes.length >= 2);

    const rA = dbRoutes.find((r) => r.path === '/api/a');
    const rB = dbRoutes.find((r) => r.path === '/api/b');

    assert.ok(rA);
    assert.ok(rB);

    assert.strictEqual(rA.routeType, 'indirect');
    assert.strictEqual(rA.hasImplicit, false); // reached via normal import
    assert.strictEqual(rB.routeType, 'indirect');
    assert.strictEqual(rB.hasImplicit, true);  // reached via java-same-package implicit relation

    // Verify sorting: direct/non-implicit comes first!
    const idxA = dbRoutes.indexOf(rA);
    const idxB = dbRoutes.indexOf(rB);
    assert.ok(idxA < idxB, 'Non-implicit route should sort before implicit route');

    // Test SQLite fast path
    // clear in-memory routes first
    const keyA = depGraph.normalizeFilePath(controllerA);
    const keyB = depGraph.normalizeFilePath(controllerB);
    const originalARoutes = depGraph.graph.get(keyA).routes;
    const originalBRoutes = depGraph.graph.get(keyB).routes;
    depGraph.graph.get(keyA).routes = [];
    depGraph.graph.get(keyB).routes = [];

    const sqliteRoutes = depGraph.findAffectedHttpRoutes(dbFile, 3);
    const sA = sqliteRoutes.find((r) => r.path === '/api/a');
    const sB = sqliteRoutes.find((r) => r.path === '/api/b');
    assert.ok(sA);
    assert.ok(sB);
    assert.strictEqual(sA.hasImplicit, false);
    assert.strictEqual(sB.hasImplicit, true);
    assert.ok(sqliteRoutes.indexOf(sA) < sqliteRoutes.indexOf(sB), 'SQLite path should sort non-implicit before implicit');

    depGraph.graph.get(keyA).routes = originalARoutes;
    depGraph.graph.get(keyB).routes = originalBRoutes;

    // Test Memory BFS fallback
    const originalCache = depGraph.cache;
    depGraph.cache = null;
    const fallbackRoutes = depGraph.findAffectedHttpRoutes(dbFile, 3);
    const fA = fallbackRoutes.find((r) => r.path === '/api/a');
    const fB = fallbackRoutes.find((r) => r.path === '/api/b');
    assert.ok(fA);
    assert.ok(fB);
    assert.strictEqual(fA.hasImplicit, false);
    assert.strictEqual(fB.hasImplicit, true);
    assert.ok(fallbackRoutes.indexOf(fA) < fallbackRoutes.indexOf(fB), 'Fallback path should sort non-implicit before implicit');
    depGraph.cache = originalCache;

    console.log('PASS: affected-http-routes-implicit-test');
  } finally {
    cleanupTempDir(testDir);
  }
}

main().catch((err) => {
  console.error('FAIL: affected-http-routes-implicit-test failed:', err);
  process.exit(1);
});
