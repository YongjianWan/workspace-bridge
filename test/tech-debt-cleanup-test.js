// @semantic
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { detectFrameworkFromContent } = require('../src/services/dep-graph/framework-patterns');
const { computeDefaultCacheDir } = require('../src/services/cache');
const { parseCliArgs } = require('../src/cli/validate-args');
const { GraphDB } = require('../src/services/graph-db');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

async function testFrameworkDetectionParity() {
  console.log('--- Testing AST Framework Detection Parity ---');

  // 1. Go Gin
  const ginContent = `
    package main
    import (
      "github.com/gin-gonic/gin"
    )
    func main() {
      r := gin.Default()
      r.GET("/ping", func(c *gin.Context) {
        c.JSON(200, gin.H{"message": "pong"})
      })
    }
  `;
  const ginRes = await detectFrameworkFromContent('user_service.go', ginContent);
  assert.strictEqual(ginRes?.framework, 'gin', 'Should detect Gin framework');

  // 2. Go Echo
  const echoContent = `
    package main
    import (
      "github.com/labstack/echo/v4"
    )
    func main() {
      e := echo.New()
      e.GET("/", func(c echo.Context) error {
        return c.String(200, "Hello, World!")
      })
    }
  `;
  const echoRes = await detectFrameworkFromContent('user_service.go', echoContent);
  assert.strictEqual(echoRes?.framework, 'echo', 'Should detect Echo framework');

  // 3. Go Fiber
  const fiberContent = `
    package main
    import "github.com/gofiber/fiber/v2"
    func main() {
      app := fiber.New()
      app.Get("/", func(c *fiber.Ctx) error {
        return c.SendString("Hello, World!")
      })
    }
  `;
  const fiberRes = await detectFrameworkFromContent('user_service.go', fiberContent);
  assert.strictEqual(fiberRes?.framework, 'fiber', 'Should detect Fiber framework');

  // 4. Rust Actix-web
  const actixContent = `
    use actix_web::{get, post, web, App, HttpServer, Responder};
    #[get("/")]
    async fn hello() -> impl Responder {
      "Hello world!"
    }
  `;
  const actixRes = await detectFrameworkFromContent('user_service.rs', actixContent);
  assert.strictEqual(actixRes?.framework, 'actix-web', 'Should detect Actix-web framework');

  // 5. Rust Axum
  const axumContent = `
    use axum::{routing::get, Router};
    let app = Router::new().route("/", get(handler));
  `;
  const axumRes = await detectFrameworkFromContent('user_service.rs', axumContent);
  assert.strictEqual(axumRes?.framework, 'axum', 'Should detect Axum framework');

  // 6. Rust Rocket
  const rocketContent = `
    #[macro_use] extern crate rocket;
    #[get("/")]
    fn index() -> &'static str {
      "Hello, world!"
    }
    #[launch]
    fn rocket() -> _ {
      rocket::build().mount("/", routes![index])
    }
  `;
  const rocketRes = await detectFrameworkFromContent('user_service.rs', rocketContent);
  assert.strictEqual(rocketRes?.framework, 'rocket', 'Should detect Rocket framework');

  // 7. Vue
  const vueContent = `
    <template>
      <div>Hello Vue</div>
    </template>
    <script setup>
    import { ref } from 'vue';
    const props = defineProps({
      msg: String
    });
    </script>
  `;
  const vueRes = await detectFrameworkFromContent('Component.vue', vueContent);
  assert.strictEqual(vueRes?.framework, 'vue', 'Should detect Vue framework');

  // 8. Svelte
  const svelteContent = `
    <script>
      import { onMount } from 'svelte';
      let name = 'world';
    </script>
    <h1>Hello {name}!</h1>
  `;
  const svelteRes = await detectFrameworkFromContent('App.svelte', svelteContent);
  assert.strictEqual(svelteRes?.framework, 'svelte', 'Should detect Svelte framework');

  console.log('✓ Framework detection parity tests passed.');
}

async function testCacheDirectoryPrecedenceAndMigration() {
  console.log('--- Testing Cache Directory Fallback, Gitignore & Migration ---');
  const root = makeTempDir('wb-cache-debt-');

  // Scenario 1: Writable workspace, should use preferred local dir and write gitignore
  const gitignorePath = path.join(root, '.gitignore');
  const dir1 = computeDefaultCacheDir(root);
  assert.strictEqual(dir1, path.join(root, '.workspace-bridge'), 'Should use preferred workspace-local dir');
  assert(fs.existsSync(gitignorePath), 'Should automatically create .gitignore');
  const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
  assert(gitignoreContent.includes('.workspace-bridge/'), 'Should write preferred dir to gitignore');

  // Scenario 2: Preferred dir not writable, should fallback to tmpdir
  // Create a file at the preferred path so mkdirSync will fail
  const blockedRoot = makeTempDir('wb-cache-blocked-');
  fs.writeFileSync(path.join(blockedRoot, '.workspace-bridge'), 'im_a_file_not_a_directory');
  const dir2 = computeDefaultCacheDir(blockedRoot);
  assert(dir2.includes(os.tmpdir()), 'Should fallback to tmpdir when preferred dir is blocked');

  // Scenario 3: Cache migration from legacy to preferred
  const migrationRoot = makeTempDir('wb-cache-migrate-');
  // First compute fallback path to pre-create legacy cache.db
  const hash = require('crypto').createHash('md5').update(migrationRoot).digest('hex').slice(0, 8);
  const legacyDir = path.join(os.tmpdir(), 'workspace-bridge', hash);
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.writeFileSync(path.join(legacyDir, 'cache.db'), 'legacy_cache_content');

  // Now run computeDefaultCacheDir which should migrate it to .workspace-bridge/cache.db
  const preferredDir = computeDefaultCacheDir(migrationRoot);
  assert.strictEqual(preferredDir, path.join(migrationRoot, '.workspace-bridge'));
  const newDbPath = path.join(preferredDir, 'cache.db');
  assert(fs.existsSync(newDbPath), 'Should migrate cache.db to new path');
  assert.strictEqual(fs.readFileSync(newDbPath, 'utf8'), 'legacy_cache_content', 'Migrated file content should match');
  assert(!fs.existsSync(path.join(legacyDir, 'cache.db')), 'Legacy cache.db should be removed');

  cleanupTempDir(root);
  cleanupTempDir(blockedRoot);
  cleanupTempDir(migrationRoot);
  console.log('✓ Cache directory fallback, gitignore, and migration tests passed.');
}

async function testConfigurationPrecedenceChain() {
  console.log('--- Testing Configuration Precedence Chain & Report ---');
  const tempRoot = makeTempDir('wb-config-debt-');
  const tempHome = makeTempDir('wb-home-mock-');

  // Mock os.homedir
  const originalHomedir = os.homedir;
  os.homedir = () => tempHome;

  try {
    // 1. Setup User Config
    const userConfigDir = path.join(tempHome, '.workspace-bridge');
    fs.mkdirSync(userConfigDir, { recursive: true });
    fs.writeFileSync(path.join(userConfigDir, 'config.toml'), 'mode = "full"\nlimit = 100\n');
    fs.writeFileSync(path.join(userConfigDir, '.env'), 'WB_FORMAT="markdown"\n');

    // 2. Setup Project Config
    const projectConfigPath = path.join(tempRoot, '.workspace-bridge.json');
    fs.writeFileSync(projectConfigPath, JSON.stringify({
      limit: 50,
      severity: 'high'
    }));

    // 3. Test Priority: User Config vs Default
    // Default format is null, mode is quick. User config has mode="full", format="markdown"
    let parsed = parseCliArgs(['node', 'cli.js', 'audit-summary', '--cwd', tempRoot]);
    assert.strictEqual(parsed.mode, 'full', 'User config should override default mode');
    assert.strictEqual(parsed.format, 'markdown', 'User .env should override default format');
    assert.strictEqual(parsed._sources.mode, 'user-config');
    assert.strictEqual(parsed._sources.format, 'user-config');

    // 4. Test Priority: Project Config vs User Config
    // Project has limit=50, severity="high". User has limit=100
    assert.strictEqual(parsed.limit, 50, 'Project config should override user config limit');
    assert.strictEqual(parsed.severity, 'high', 'Project config should set severity');
    assert.strictEqual(parsed._sources.limit, 'project-config');
    assert.strictEqual(parsed._sources.severity, 'project-config');

    // 5. Test Priority: Env var vs Project Config
    process.env.WB_LIMIT = '20';
    process.env.WB_SEVERITY = 'low';
    parsed = parseCliArgs(['node', 'cli.js', 'audit-summary', '--cwd', tempRoot]);
    assert.strictEqual(parsed.limit, 20, 'Env var should override project config limit');
    assert.strictEqual(parsed.severity, 'low', 'Env var should override project config severity');
    assert.strictEqual(parsed._sources.limit, 'env');
    assert.strictEqual(parsed._sources.severity, 'env');

    // 6. Test Priority: CLI vs Env var
    parsed = parseCliArgs(['node', 'cli.js', 'audit-summary', '--cwd', tempRoot, '--limit', '10', '--severity', 'medium']);
    assert.strictEqual(parsed.limit, 10, 'CLI should override Env var limit');
    assert.strictEqual(parsed.severity, 'medium', 'CLI should override Env var severity');
    assert.strictEqual(parsed._sources.limit, 'cli');
    assert.strictEqual(parsed._sources.severity, 'cli');

  } finally {
    os.homedir = originalHomedir;
    delete process.env.WB_LIMIT;
    delete process.env.WB_SEVERITY;
    cleanupTempDir(tempRoot);
    cleanupTempDir(tempHome);
  }

  console.log('✓ Configuration precedence chain tests passed.');
}

async function testConcurrentLockingAndReadRetry() {
  console.log('--- Testing Concurrent Locking & Read Retry ---');
  const root = makeTempDir('wb-lock-debt-');
  const dbPath = path.join(root, 'test-lock.db');
  const lockPath = `${dbPath}.lock`;

  const { acquireLockSync, releaseLockSync } = require('../src/services/graph-db');

  // 1. Acquire lock on db1 path
  acquireLockSync(lockPath);

  // 2. Try to acquire the same lock, expecting it to fail/timeout quickly
  try {
    acquireLockSync(lockPath, 50, 10);
    assert.fail('Should have failed to acquire write lock due to conflict');
  } catch (err) {
    assert(err.message.includes('Lock acquisition timed out'), 'Should throw timeout error');
  }

  // 3. Release lock
  releaseLockSync(lockPath);

  // 4. Try again, it should succeed now
  acquireLockSync(lockPath, 50, 10);
  releaseLockSync(lockPath);

  // 5. Test empty lock recovery: create an empty lock file manually, then try to acquire lock
  fs.writeFileSync(lockPath, '');
  acquireLockSync(lockPath, 50, 10); // Should succeed immediately by unlinking the empty lock
  releaseLockSync(lockPath);

  cleanupTempDir(root);
  console.log('✓ Concurrent locking and read retry tests passed.');
}

async function main() {
  try {
    await testFrameworkDetectionParity();
    await testCacheDirectoryPrecedenceAndMigration();
    await testConfigurationPrecedenceChain();
    await testConcurrentLockingAndReadRetry();
    console.log('\nALL TECH DEBT CLEANUP TESTS PASSED SUCCESSFULLY.');
    process.exit(0);
  } catch (err) {
    console.error('\nTest execution failed:', err);
    process.exit(1);
  }
}

main();
