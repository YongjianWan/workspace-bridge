#!/usr/bin/env node
// @semantic
/**
 * affected-routes 端到端请求路径测试
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const assert = require('assert');
const { runCliInProcess, cleanupTempDir } = require('./test-helpers');

async function main() {
  const testDir = path.join(os.tmpdir(), 'wb-test-routes-' + crypto.randomBytes(4).toString('hex'));
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }
  fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify({ name: 'routes-test', version: '1.0.0' }, null, 2));

  // Build a small graph:
  //   entry.js -> controller.js -> service.js -> util.js
  //   entry.js -> middleware.js -> controller.js
  const entryFile = path.join(testDir, 'entry.js');
  const middlewareFile = path.join(testDir, 'middleware.js');
  const controllerFile = path.join(testDir, 'controller.js');
  const serviceFile = path.join(testDir, 'service.js');
  const utilFile = path.join(testDir, 'util.js');

  fs.writeFileSync(entryFile, `#!/usr/bin/env node\nconst c = require('./controller');\nconst m = require('./middleware');\nmodule.exports = () => c();`);
  fs.writeFileSync(middlewareFile, `const c = require('./controller');\nmodule.exports = (req) => c(req);`);
  fs.writeFileSync(controllerFile, `const s = require('./service');\nmodule.exports = (req) => s.process(req);`);
  fs.writeFileSync(serviceFile, `const u = require('./util');\nmodule.exports = { process: (x) => u.helper(x) };`);
  fs.writeFileSync(utilFile, `module.exports = { helper: (x) => x };`);

  try {
    // 1. Basic contract: util.js should have routes from entry.js
    const result = await runCliInProcess(['affected-routes', '--cwd', testDir, '--file', 'util.js', '--json', '--quiet']);
    assert.strictEqual(result.ok, true, 'result.ok should be true');
    assert.strictEqual(typeof result.routesCount, 'number', 'routesCount should be a number');
    assert(Array.isArray(result.routes), 'routes should be an array');
    assert(result.routes.length > 0, 'util.js should have at least one route');

    // 2. Semantic: route path starts at entry and ends at util
    const route = result.routes[0];
    assert.strictEqual(typeof route.entry, 'string', 'route.entry should be a string');
    assert(Array.isArray(route.path), 'route.path should be an array');
    assert.strictEqual(route.path[route.path.length - 1], utilFile, 'route.path should end at util.js');
    assert.strictEqual(route.path[0], entryFile, 'route.path should start at entry.js');
    assert(Number.isFinite(route.depth) && route.depth >= 2, 'route.depth should be >= 2');

    // 3. maxDepth limits routes
    const limited = await runCliInProcess(['affected-routes', '--cwd', testDir, '--file', 'util.js', '--max-depth', '2', '--json', '--quiet']);
    assert.strictEqual(limited.maxDepth, 2, 'maxDepth should be 2');
    // With maxDepth=2, util.js is 4 hops from entry, so no routes should be found
    assert.strictEqual(limited.routesCount, 0, 'routes should be empty when maxDepth is too shallow');

    // 4. Entry file itself should have 0 routes (no upstream entry)
    const entryResult = await runCliInProcess(['affected-routes', '--cwd', testDir, '--file', 'entry.js', '--json', '--quiet']);
    assert.strictEqual(entryResult.routesCount, 0, 'entry file should have 0 routes');

    console.log('affected-routes-test: ALL PASSED');
  } finally {
    cleanupTempDir(testDir);
  }
}

main();
