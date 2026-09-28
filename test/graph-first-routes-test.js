#!/usr/bin/env node
// @semantic
/**
 * Graph-first 路由提取与影响分析测试
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const assert = require('assert');
const { runCliInProcess, cleanupTempDir } = require('./test-helpers');
const { ServiceContainer } = require('../src/services/container');
const { hashFileContent } = require('../src/services/cache');

async function main() {
  const testDir = path.join(os.tmpdir(), 'wb-test-gf-routes-' + crypto.randomBytes(4).toString('hex'));
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }

  // 1. 初始化项目
  fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify({ name: 'gf-routes-test', version: '1.0.0' }, null, 2));
  
  // 创建依赖链: app.js -> route.js -> service.js -> db.js
  // 其中 route.js 包含 Express 路由，app.js 是 Entry
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
    // 2. 初始化容器进行冷启动构建
    const container = new ServiceContainer({ quiet: true });
    await container.initialize(testDir, 30000, { watch: false });

    const depGraph = container.snapshot.graph._dg;
    assert.ok(depGraph, 'DependencyGraph should be initialized');

    // --- 场景 A: 验证 AST 解析时路由被提取并挂载在节点上 ---
    const routeNode = depGraph.getFileInfo(routeFile);
    assert.ok(routeNode, 'route.js node should exist in graph');
    assert.ok(Array.isArray(routeNode.routes), 'route.routes should be an array');
    assert.strictEqual(routeNode.routes.length, 2, 'Should extract 2 routes');
    assert.strictEqual(routeNode.routes[0].path, '/api/users', 'First route path mismatch');
    assert.strictEqual(routeNode.routes[1].path, '/api/users/create', 'Second route path mismatch');

    // --- 场景 D: 验证 findAffectedHttpRoutes 穿透多层 file 依赖获取到终端的 API 路由 ---
    // 更改 db.js 会影响到 app.js, route.js, service.js, db.js
    // 它应该能通过 BFS 追溯到 route.js 上的路由
    const affectedHttpRoutes = depGraph.findAffectedHttpRoutes(dbFile, 3);
    assert.strictEqual(affectedHttpRoutes.length, 2, 'db.js change should affect 2 Http routes');
    assert.ok(affectedHttpRoutes.some(r => r.path === '/api/users'), '/api/users route should be affected');
    assert.ok(affectedHttpRoutes.some(r => r.path === '/api/users/create'), '/api/users/create route should be affected');

    // --- 场景 B: 验证重启后从解析缓存重建的图结构 ---
    const newContainer = new ServiceContainer({ quiet: true });
    await newContainer.initialize(testDir, 30000, { watch: false });
    const loadedGraph = newContainer.snapshot.graph._dg;

    // 检查 loadedGraph 的依赖是否正常（没有被 handles-route 污染）
    const loadedRouteNode = loadedGraph.getFileInfo(routeFile);
    assert.ok(loadedRouteNode, 'Loaded routeNode should exist');
    assert.deepStrictEqual(loadedRouteNode.imports, [loadedGraph.normalizeFilePath(serviceFile)], 'imports should only contain service.js');
    assert.strictEqual(loadedRouteNode.routes.length, 2, 'Loaded routes should be restored to memory');

    // --- 场景 C: 增量更新验证 ---
    // 修改 route.js 内容以删除一个路由并新增一个路由
    fs.writeFileSync(routeFile, `
      const express = require('express');
      const router = express.Router();
      const s = require('./service');
      router.get('/api/users/update', (req, res) => res.json(s.updateUser()));
      module.exports = router;
    `);

    // 模拟 watcher 重新索引：metadata 带上新内容的 hash（FileIndex 的写法）
    newContainer.cache.setFileMetadata(routeFile, {
      mtime: Date.now(),
      size: fs.statSync(routeFile).size,
      hash: hashFileContent(fs.readFileSync(routeFile)),
    });

    // 触发增量更新
    await loadedGraph.updateFiles([routeFile]);

    const updatedNode = loadedGraph.getFileInfo(routeFile);
    assert.strictEqual(updatedNode.routes.length, 1, 'Incremental update should update memory routes to size 1');
    assert.strictEqual(updatedNode.routes[0].path, '/api/users/update', 'Incremental route path mismatch');

    // 验证 SQLite 缓存的 parse_results 也同步更新了
    const parseResultInDb = newContainer.cache.getParseResult(routeFile);
    assert.strictEqual(parseResultInDb.routes.length, 1, 'Db cache routes size mismatch after incremental update');
    assert.strictEqual(parseResultInDb.routes[0].path, '/api/users/update', 'Db cache route path mismatch after incremental update');

    // --- 场景 E: 验证通过 CLI 调用的 impact 计算受影响路由是否一致 ---
    const cliResult = await runCliInProcess(['impact', '--cwd', testDir, '--file', 'db.js', '--json', '--quiet']);
    assert.strictEqual(cliResult.ok, true, 'cli impact should succeed');
    assert.strictEqual(cliResult.affectedRoutes.length, 1, 'CLI affectedRoutes length mismatch');
    assert.strictEqual(cliResult.affectedRoutes[0].path, '/api/users/update', 'CLI affected route path mismatch');

    console.log('graph-first-routes-test: ALL PASSED');
  } finally {
    cleanupTempDir(testDir);
  }
}

main().catch(err => {
  console.error('graph-first-routes-test failed:', err);
  process.exit(1);
});
