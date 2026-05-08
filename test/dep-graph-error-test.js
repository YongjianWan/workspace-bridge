#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DependencyGraph } = require('../src/services/dep-graph');
const { WorkspaceCache } = require('../src/services/cache');

async function testUpdateFilesEmptyArray() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-dg-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{}', 'utf8');
  const cache = new WorkspaceCache(dir);
  const dg = new DependencyGraph(dir, cache);

  // Should not crash on empty array
  await dg.updateFiles([]);

  fs.rmSync(dir, { recursive: true, force: true });
}

async function testUpdateFilesDeletedFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-dg-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{}', 'utf8');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), "export const a = 1;\n", 'utf8');
  fs.writeFileSync(path.join(dir, 'src', 'b.js'), "import { a } from './a';\n", 'utf8');

  const cache = new WorkspaceCache(dir);
  // Seed cache with file metadata so dep-graph sees the files
  const aPath = path.join(dir, 'src', 'a.js');
  const bPath = path.join(dir, 'src', 'b.js');
  cache.setFileMetadata(aPath, { mtime: 1, size: 1 });
  cache.setFileMetadata(bPath, { mtime: 1, size: 1 });

  const dg = new DependencyGraph(dir, cache);
  await dg.build();

  assert(dg.hasFile(bPath), 'b.js should be in graph after build');

  // Now delete a.js and update
  fs.unlinkSync(aPath);
  await dg.updateFiles([aPath]);

  assert.strictEqual(dg.hasFile(aPath), false);

  fs.rmSync(dir, { recursive: true, force: true });
}

async function testAnalyzeFileHandlesMissingFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-dg-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{}', 'utf8');
  const cache = new WorkspaceCache(dir);
  const dg = new DependencyGraph(dir, cache);

  // Should not crash on missing file
  await dg.analyzeFile(path.join(dir, 'missing.js'));
  assert.strictEqual(dg.hasFile(path.join(dir, 'missing.js')), false);

  fs.rmSync(dir, { recursive: true, force: true });
}

async function testReentrantUpdateFiles() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-dg-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{}', 'utf8');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'x.js'), "export const x = 1;\n", 'utf8');

  const cache = new WorkspaceCache(dir);
  const dg = new DependencyGraph(dir, cache);
  await dg.build();

  // Simulate overlapping calls: second should return immediately
  const p1 = dg.updateFiles([path.join(dir, 'src', 'x.js')]);
  const p2 = dg.updateFiles([path.join(dir, 'src', 'x.js')]);
  await Promise.all([p1, p2]);

  // Should complete without deadlock
  assert.strictEqual(dg._updating, false);

  fs.rmSync(dir, { recursive: true, force: true });
}

async function testGetStatsLazyCycles() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-dg-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{}', 'utf8');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  const aPath = path.join(dir, 'src', 'a.js');
  const bPath = path.join(dir, 'src', 'b.js');
  fs.writeFileSync(aPath, "import './b';\nexport const a = 1;\n", 'utf8');
  fs.writeFileSync(bPath, "import './a';\nexport const b = 1;\n", 'utf8');

  const cache = new WorkspaceCache(dir);
  cache.setFileMetadata(aPath, { mtime: 1, size: 1 });
  cache.setFileMetadata(bPath, { mtime: 1, size: 1 });

  const dg = new DependencyGraph(dir, cache);
  await dg.build();

  const stats1 = dg.getStats();
  assert.strictEqual(stats1.cycles, 1);

  // After update, cycle count should be recalculated
  fs.writeFileSync(bPath, "export const b = 1;\n", 'utf8');
  // Simulate mtime change so updateFiles does not skip the file
  cache.setFileMetadata(bPath, { mtime: Date.now(), size: 1 });
  await dg.updateFiles([bPath]);

  const stats2 = dg.getStats();
  assert.strictEqual(stats2.cycles, 0);

  fs.rmSync(dir, { recursive: true, force: true });
}

async function testVueFrameworkCycleWhitelist() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-dg-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{}', 'utf8');
  fs.mkdirSync(path.join(dir, 'src', 'store'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src', 'router'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src', 'views'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src', 'utils'), { recursive: true });

  const storePath = path.join(dir, 'src', 'store', 'user.js');
  const routerPath = path.join(dir, 'src', 'router', 'index.js');
  const viewPath = path.join(dir, 'src', 'views', 'login.vue');
  const utilAPath = path.join(dir, 'src', 'utils', 'a.js');
  const utilBPath = path.join(dir, 'src', 'utils', 'b.js');

  fs.writeFileSync(storePath, "import router from '../router/index';\nexport const user = {};\n", 'utf8');
  fs.writeFileSync(routerPath, "import view from '../views/login.vue';\nexport const routes = [];\n", 'utf8');
  fs.writeFileSync(viewPath, "<script>\nimport store from '../store/user';\nexport default {};\n</script>\n", 'utf8');
  fs.writeFileSync(utilAPath, "import b from './b';\nexport const a = 1;\n", 'utf8');
  fs.writeFileSync(utilBPath, "import a from './a';\nexport const b = 2;\n", 'utf8');

  const cache = new WorkspaceCache(dir);
  [storePath, routerPath, viewPath, utilAPath, utilBPath].forEach((p) => {
    cache.setFileMetadata(p, { mtime: 1, size: 1 });
  });

  const dg = new DependencyGraph(dir, cache);
  await dg.build();

  // Vue store-router-view cycle should be filtered out
  const cycles = dg.findCircularDependencies();
  const hasVueCycle = cycles.some((c) =>
    c.some((f) => f.includes('store')) && c.some((f) => f.includes('router')) && c.some((f) => f.includes('login.vue'))
  );
  assert.strictEqual(hasVueCycle, false, 'Vue store-router-view cycle should be whitelisted');

  // Non-Vue cycle in utils should remain
  const hasUtilCycle = cycles.some((c) => c.some((f) => f.includes('utils')));
  assert.strictEqual(hasUtilCycle, true, 'Non-Vue cycle should not be whitelisted');

  fs.rmSync(dir, { recursive: true, force: true });
}

async function testSpringBootEntryDetection() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-dg-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{}', 'utf8');
  fs.mkdirSync(path.join(dir, 'src', 'main', 'java', 'com', 'example'), { recursive: true });

  const appPath = path.join(dir, 'src', 'main', 'java', 'com', 'example', 'DemoApplication.java');
  const configPath = path.join(dir, 'src', 'main', 'java', 'com', 'example', 'AppConfig.java');
  const plainPath = path.join(dir, 'src', 'main', 'java', 'com', 'example', 'Helper.java');

  fs.writeFileSync(appPath, '@SpringBootApplication\npublic class DemoApplication {\n  public static void main(String[] args) {}\n}\n', 'utf8');
  fs.writeFileSync(configPath, '@Configuration\npublic class AppConfig {\n  @Bean\n  public Object bean() { return null; }\n}\n', 'utf8');
  fs.writeFileSync(plainPath, 'public class Helper {\n  public static void help() {}\n}\n', 'utf8');

  const cache = new WorkspaceCache(dir);
  [appPath, configPath, plainPath].forEach((p) => {
    cache.setFileMetadata(p, { mtime: 1, size: 1 });
  });

  const dg = new DependencyGraph(dir, cache);
  await dg.build();

  const dead = dg.findDeadExports();
  const deadFiles = dead.map((d) => d.file);

  // Use lowercase basename comparison to avoid Windows path normalization mismatches
  const deadBasenames = dead.map((d) => path.basename(d.file).toLowerCase());
  assert.strictEqual(deadBasenames.includes(path.basename(appPath).toLowerCase()), false, 'Spring Boot Application should not be dead export');
  assert.strictEqual(deadBasenames.includes(path.basename(configPath).toLowerCase()), false, 'Spring Boot @Configuration should not be dead export');
  assert.strictEqual(deadBasenames.includes(path.basename(plainPath).toLowerCase()), true, 'Plain helper class should be dead export');

  fs.rmSync(dir, { recursive: true, force: true });
}

async function main() {
  await testUpdateFilesEmptyArray();
  await testUpdateFilesDeletedFile();
  await testAnalyzeFileHandlesMissingFile();
  await testReentrantUpdateFiles();
  await testGetStatsLazyCycles();
  await testVueFrameworkCycleWhitelist();
  await testSpringBootEntryDetection();
  console.log('dep-graph-error-test: all passed');
}

main().catch((e) => { console.error(e); process.exit(1); });
