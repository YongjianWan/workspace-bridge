#!/usr/bin/env node
// @contract
// @slow

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');
const { DependencyGraph } = require('../src/services/dep-graph');
const { WorkspaceCache } = require('../src/services/cache');

async function testUpdateFilesEmptyArray() {
  const dir = makeTempDir('wb-dg-');
  fs.writeFileSync(path.join(dir, 'package.json'), '{}', 'utf8');
  const cache = new WorkspaceCache(dir);
  const dg = new DependencyGraph(dir, cache);

  // Should not crash on empty array
  await dg.updateFiles([]);

  cleanupTempDir(dir);
}

async function testUpdateFilesDeletedFile() {
  const dir = makeTempDir('wb-dg-');
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

  cleanupTempDir(dir);
}

async function testAnalyzeFileHandlesMissingFile() {
  const dir = makeTempDir('wb-dg-');
  fs.writeFileSync(path.join(dir, 'package.json'), '{}', 'utf8');
  const cache = new WorkspaceCache(dir);
  const dg = new DependencyGraph(dir, cache);

  // Should not crash on missing file
  await dg.analyzeFile(path.join(dir, 'missing.js'));
  assert.strictEqual(dg.hasFile(path.join(dir, 'missing.js')), false);

  cleanupTempDir(dir);
}

async function testReentrantUpdateFiles() {
  const dir = makeTempDir('wb-dg-');
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

  // Should complete without deadlock; _updating backward compat
  assert.strictEqual(dg._updating, false);
  assert.strictEqual(dg._state, 'READY');

  cleanupTempDir(dir);
}

async function testGetStatsLazyCycles() {
  const dir = makeTempDir('wb-dg-');
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

  cleanupTempDir(dir);
}

async function testVueFrameworkCycleWhitelist() {
  const dir = makeTempDir('wb-dg-');
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

  // Vue store-router-view cycle filtered by MVVM logic→view boundary (Rule 4 in _getCircularDependencies)
  const cycles = dg.findCircularDependencies();
  const hasVueCycle = cycles.some((c) =>
    c.some((f) => f.includes('store')) && c.some((f) => f.includes('router')) && c.some((f) => f.includes('login.vue'))
  );
  assert.strictEqual(hasVueCycle, false, 'Vue store-router-view cycle should be filtered by MVVM logic→view boundary');

  // Non-Vue cycle in utils should remain
  const hasUtilCycle = cycles.some((c) => c.some((f) => f.includes('utils')));
  assert.strictEqual(hasUtilCycle, true, 'Non-Vue cycle should not be whitelisted');

  cleanupTempDir(dir);
}

// P96: Vue length=6 cycle (request→store→router→view→api→request) should be whitelisted
async function testVueLongCycleWhitelist() {
  const dir = makeTempDir('wb-dg-long-');
  fs.writeFileSync(path.join(dir, 'package.json'), '{}', 'utf8');
  fs.mkdirSync(path.join(dir, 'src', 'api'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src', 'store'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src', 'router'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src', 'views'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src', 'request'), { recursive: true });

  const requestPath = path.join(dir, 'src', 'request', 'index.js');
  const storePath = path.join(dir, 'src', 'store', 'user.js');
  const routerPath = path.join(dir, 'src', 'router', 'index.js');
  const viewPath = path.join(dir, 'src', 'views', 'login.vue');
  const apiPath = path.join(dir, 'src', 'api', 'user.js');

  // request → store → router → view → api → request (length=6)
  fs.writeFileSync(requestPath, "import store from '../store/user';\nexport const fetch = () => {};\n", 'utf8');
  fs.writeFileSync(storePath, "import router from '../router/index';\nexport const user = {};\n", 'utf8');
  fs.writeFileSync(routerPath, "import view from '../views/login.vue';\nexport const routes = [];\n", 'utf8');
  fs.writeFileSync(viewPath, "<script>\nimport api from '../api/user';\nexport default {};\n</script>\n", 'utf8');
  fs.writeFileSync(apiPath, "import request from '../request/index';\nexport const getUser = () => {};\n", 'utf8');

  const cache = new WorkspaceCache(dir);
  [requestPath, storePath, routerPath, viewPath, apiPath].forEach((p) => {
    cache.setFileMetadata(p, { mtime: 1, size: 1 });
  });

  const dg = new DependencyGraph(dir, cache);
  await dg.build();

  const cycles = dg.findCircularDependencies();
  const hasLongVueCycle = cycles.some((c) =>
    c.some((f) => f.includes('request')) &&
    c.some((f) => f.includes('store')) &&
    c.some((f) => f.includes('router')) &&
    c.some((f) => f.includes('login.vue')) &&
    c.some((f) => f.includes('api'))
  );
  assert.strictEqual(hasLongVueCycle, false, 'Vue length=6 cycle (request→store→router→view→api→request) should be filtered by MVVM logic→view boundary');

  cleanupTempDir(dir);
}

async function testSpringBootEntryDetection() {
  const dir = makeTempDir('wb-dg-');
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

  cleanupTempDir(dir);
}

async function testDjangoEntryDetection() {
  const dir = makeTempDir('wb-dg-');
  fs.writeFileSync(path.join(dir, 'package.json'), '{}', 'utf8');
  fs.mkdirSync(path.join(dir, 'core', 'management', 'commands'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'core', 'views'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'task_management'), { recursive: true });

  const cmdPath = path.join(dir, 'core', 'management', 'commands', 'cleanup.py');
  const viewPath = path.join(dir, 'core', 'views', 'login.py');
  const viewPrefixPath = path.join(dir, 'task_management', 'views_coordination.py');
  const adminPath = path.join(dir, 'core', 'admin.py');
  const tasksPath = path.join(dir, 'core', 'tasks.py');
  const plainPath = path.join(dir, 'core', 'utils.py');

  fs.writeFileSync(cmdPath, 'from django.core.management.base import BaseCommand\n\nclass Command(BaseCommand):\n    help = "Cleanup"\n', 'utf8');
  fs.writeFileSync(viewPath, 'from django.http import JsonResponse\n\ndef login(request):\n    return JsonResponse({})\n', 'utf8');
  fs.writeFileSync(viewPrefixPath, 'from django.http import JsonResponse\n\ndef coord(request):\n    return JsonResponse({})\n', 'utf8');
  fs.writeFileSync(adminPath, 'from django.contrib import admin\nfrom .models import User\n\nadmin.site.register(User)\n', 'utf8');
  fs.writeFileSync(tasksPath, 'from celery import shared_task\n\n@shared_task\ndef add(x, y):\n    return x + y\n', 'utf8');
  fs.writeFileSync(plainPath, 'def helper():\n    pass\n', 'utf8');

  const cache = new WorkspaceCache(dir);
  [cmdPath, viewPath, adminPath, tasksPath, plainPath].forEach((p) => {
    cache.setFileMetadata(p, { mtime: 1, size: 1 });
  });

  const dg = new DependencyGraph(dir, cache);
  await dg.build();

  const dead = dg.findDeadExports();
  const deadBasenames = dead.map((d) => path.basename(d.file).toLowerCase());

  assert.strictEqual(deadBasenames.includes(path.basename(cmdPath).toLowerCase()), false, 'Django management command should not be dead export');
  assert.strictEqual(deadBasenames.includes(path.basename(viewPath).toLowerCase()), false, 'Django views should not be dead export');
  assert.strictEqual(deadBasenames.includes(path.basename(viewPrefixPath).toLowerCase()), false, 'Django views_coordination should not be dead export');
  assert.strictEqual(deadBasenames.includes(path.basename(adminPath).toLowerCase()), false, 'Django admin should not be dead export');
  assert.strictEqual(deadBasenames.includes(path.basename(tasksPath).toLowerCase()), false, 'Celery tasks should not be dead export');
  assert.strictEqual(deadBasenames.includes(path.basename(plainPath).toLowerCase()), true, 'Plain helper should be dead export');

  cleanupTempDir(dir);
}

// P97: RuoYi scaffold utility mutual dependencies should be whitelisted
async function testRuoYiJavaCycleWhitelist() {
  const dir = makeTempDir('wb-dg-');
  fs.writeFileSync(path.join(dir, 'package.json'), '{}', 'utf8');
  fs.mkdirSync(path.join(dir, 'src', 'main', 'java', 'com', 'ruoyi', 'common', 'utils'), { recursive: true });

  const stringUtilsPath = path.join(dir, 'src', 'main', 'java', 'com', 'ruoyi', 'common', 'utils', 'StringUtils.java');
  const strFormatterPath = path.join(dir, 'src', 'main', 'java', 'com', 'ruoyi', 'common', 'utils', 'StrFormatter.java');

  // StringUtils ↔ StrFormatter (mutual scaffold dependency)
  fs.writeFileSync(stringUtilsPath, 'package com.ruoyi.common.utils;\nimport com.ruoyi.common.utils.StrFormatter;\npublic class StringUtils { }\n', 'utf8');
  fs.writeFileSync(strFormatterPath, 'package com.ruoyi.common.utils;\nimport com.ruoyi.common.utils.StringUtils;\npublic class StrFormatter { }\n', 'utf8');

  const cache = new WorkspaceCache(dir);
  cache.setFileMetadata(stringUtilsPath, { mtime: 1, size: 1 });
  cache.setFileMetadata(strFormatterPath, { mtime: 1, size: 1 });

  const dg = new DependencyGraph(dir, cache);
  await dg.build();

  const cycles = dg.findCircularDependencies();
  const hasRuoYiCycle = cycles.some((c) =>
    c.some((f) => f.toLowerCase().includes('stringutils')) &&
    c.some((f) => f.toLowerCase().includes('strformatter'))
  );
  assert.strictEqual(hasRuoYiCycle, false, 'RuoYi StringUtils↔StrFormatter cycle should be filtered by Java utility↔utility edge pruning');

  cleanupTempDir(dir);
}

// P97-1: RuoYi annotation↔serializer pair should be whitelisted
async function testRuoYiAnnotationSerializerCycleWhitelist() {
  const dir = makeTempDir('wb-dg-');
  fs.writeFileSync(path.join(dir, 'package.json'), '{}', 'utf8');
  fs.mkdirSync(path.join(dir, 'src', 'main', 'java', 'com', 'ruoyi', 'common', 'annotation'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src', 'main', 'java', 'com', 'ruoyi', 'common', 'config', 'serializer'), { recursive: true });

  const sensitivePath = path.join(dir, 'src', 'main', 'java', 'com', 'ruoyi', 'common', 'annotation', 'Sensitive.java');
  const serializerPath = path.join(dir, 'src', 'main', 'java', 'com', 'ruoyi', 'common', 'config', 'serializer', 'SensitiveJsonSerializer.java');

  // Sensitive ↔ SensitiveJsonSerializer (annotation/serializer scaffold pair)
  fs.writeFileSync(sensitivePath, 'package com.ruoyi.common.annotation;\nimport com.ruoyi.common.config.serializer.SensitiveJsonSerializer;\npublic @interface Sensitive { }\n', 'utf8');
  fs.writeFileSync(serializerPath, 'package com.ruoyi.common.config.serializer;\nimport com.ruoyi.common.annotation.Sensitive;\npublic class SensitiveJsonSerializer { }\n', 'utf8');

  const cache = new WorkspaceCache(dir);
  cache.setFileMetadata(sensitivePath, { mtime: 1, size: 1 });
  cache.setFileMetadata(serializerPath, { mtime: 1, size: 1 });

  const dg = new DependencyGraph(dir, cache);
  await dg.build();

  const cycles = dg.findCircularDependencies();
  const hasCycle = cycles.some((c) =>
    c.some((f) => f.toLowerCase().includes('sensitive.java')) &&
    c.some((f) => f.toLowerCase().includes('sensitivejsonserializer'))
  );
  assert.strictEqual(hasCycle, false, 'RuoYi Sensitive↔SensitiveJsonSerializer cycle should be filtered by annotation-only target edge pruning');

  cleanupTempDir(dir);
}

async function testAnalyzeFileHandlesParserCrash() {
  const dir = makeTempDir('wb-dg-crash-');
  fs.writeFileSync(path.join(dir, 'package.json'), '{}', 'utf8');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'good.js'), "export const ok = 1;\n", 'utf8');
  fs.writeFileSync(path.join(dir, 'src', 'bad.js'), "export const bad = 1;\n", 'utf8');

  const cache = new WorkspaceCache(dir);
  const goodPath = path.join(dir, 'src', 'good.js');
  const badPath = path.join(dir, 'src', 'bad.js');
  cache.setFileMetadata(goodPath, { mtime: 1, size: 1 });
  cache.setFileMetadata(badPath, { mtime: 1, size: 1 });

  const dg = new DependencyGraph(dir, cache);

  // Monkey-patch registry so .js files throw during parsing
  const { registry } = require('../src/services/dep-graph/parsers/registry');
  const entry = registry.findByExt('.js');
  const origParser = entry.parser;
  entry.parser = () => { throw new Error('Simulated parser crash'); };

  try {
    await dg.analyzeFile(goodPath);
    await dg.analyzeFile(badPath);

    // Neither file should be in graph after parser crash
    assert.strictEqual(dg.hasFile(goodPath), false, 'good.js should not be in graph after parser crash');
    assert.strictEqual(dg.hasFile(badPath), false, 'bad.js should not be in graph after parser crash');

    // buildWarnings should report parser-error
    const warnings = dg.buildWarnings();
    const parserWarning = warnings.find((w) => w.type === 'parser-error');
    assert.ok(parserWarning, 'buildWarnings should include parser-error warning');
    assert.strictEqual(parserWarning.files, 2, 'parser-error should count 2 files');
  } finally {
    entry.parser = origParser;
  }

  cleanupTempDir(dir);
}

async function testGraphStateMachine() {
  const dir = makeTempDir('wb-dg-state-');
  fs.writeFileSync(path.join(dir, 'package.json'), '{}', 'utf8');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), "export const a = 1;\n", 'utf8');

  const cache = new WorkspaceCache(dir);
  const dg = new DependencyGraph(dir, cache);

  // Initial state
  assert.strictEqual(dg._state, 'IDLE', 'Initial state should be IDLE');
  assert.strictEqual(dg._updating, false, '_updating backward-compat at IDLE');

  await dg.build();

  // After build
  assert.strictEqual(dg._state, 'READY', 'State after build should be READY');
  assert.strictEqual(dg._updating, false, '_updating backward-compat at READY');

  cleanupTempDir(dir);
}

async function testQueryThrowsWhenNotReady() {
  const dir = makeTempDir('wb-dg-query-');
  fs.writeFileSync(path.join(dir, 'package.json'), '{}', 'utf8');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), "export const a = 1;\n", 'utf8');

  const cache = new WorkspaceCache(dir);
  const dg = new DependencyGraph(dir, cache);

  // Before build, query should throw
  let threw = false;
  try {
    dg.getDependencies(path.join(dir, 'src', 'a.js'));
  } catch (e) {
    threw = true;
    assert.ok(e.message.includes('not ready'), 'Error should mention not ready: ' + e.message);
  }
  assert.strictEqual(threw, true, 'Query should throw when graph not ready');

  cleanupTempDir(dir);
}

async function testTarjanJohnsonCycleRobustness() {
  const dir = makeTempDir('wb-dg-stress-');
  fs.writeFileSync(path.join(dir, 'package.json'), '{}', 'utf8');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });

  const aPath = path.join(dir, 'src', 'a.js');
  const bPath = path.join(dir, 'src', 'b.js');
  const cPath = path.join(dir, 'src', 'c.js');
  const dPath = path.join(dir, 'src', 'd.js');

  // Construct a K_4 clique (complete graph) to stress-test overlapping cycles & blockedMap unblocking:
  // a -> b, c, d
  // b -> a, c, d
  // c -> a, b, d
  // d -> a, b, c
  fs.writeFileSync(aPath, "import './b'; import './c'; import './d';\n", 'utf8');
  fs.writeFileSync(bPath, "import './a'; import './c'; import './d';\n", 'utf8');
  fs.writeFileSync(cPath, "import './a'; import './b'; import './d';\n", 'utf8');
  fs.writeFileSync(dPath, "import './a'; import './b'; import './c';\n", 'utf8');

  const cache = new WorkspaceCache(dir);
  [aPath, bPath, cPath, dPath].forEach((p) => {
    cache.setFileMetadata(p, { mtime: 1, size: 1 });
  });

  const dg = new DependencyGraph(dir, cache);
  await dg.build();

  // Test execution & stability
  const cycles = dg.findCircularDependencies();
  assert.ok(Array.isArray(cycles), 'Cycles should be an array');
  assert.ok(cycles.length > 0, 'Should find cycles in K_4 clique');

  // Verify uniqueness and stability by rotating each cycle to start with its minimum node:
  const rotateToMin = (cycle) => {
    const minNode = [...cycle].sort()[0];
    const idx = cycle.indexOf(minNode);
    return [...cycle.slice(idx), ...cycle.slice(0, idx)].join(' -> ');
  };
  const cycleStrings = cycles.map(rotateToMin);
  assert.strictEqual(new Set(cycleStrings).size, cycles.length, 'All discovered cycles must be structurally unique directed loops');
  assert.strictEqual(cycles.length, 20, 'K_4 clique should yield exactly 20 unique simple directed cycles');

  cleanupTempDir(dir);
}

async function main() {
  await testUpdateFilesEmptyArray();
  await testUpdateFilesDeletedFile();
  await testAnalyzeFileHandlesMissingFile();
  await testAnalyzeFileHandlesParserCrash();
  await testReentrantUpdateFiles();
  await testGraphStateMachine();
  await testQueryThrowsWhenNotReady();
  await testGetStatsLazyCycles();
  await testVueFrameworkCycleWhitelist();
  await testVueLongCycleWhitelist();
  await testSpringBootEntryDetection();
  await testDjangoEntryDetection();
  await testRuoYiJavaCycleWhitelist();
  await testRuoYiAnnotationSerializerCycleWhitelist();
  await testTarjanJohnsonCycleRobustness();
}

main().catch((e) => { console.error(e); process.exit(1); });
