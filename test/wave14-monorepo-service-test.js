#!/usr/bin/env node
// @contract — Monorepo boundary detection, --service filtering, reference role downgrade

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseCliArgs, sanitizeCliPaths } = require('../src/cli/validate-args');
const { ProjectContext } = require('../src/utils/project-context');
const { DependencyGraph } = require('../src/services/dep-graph');

/* -------------------------------------------------------------------------- */
// Test 1: No --service → all files active by default
/* -------------------------------------------------------------------------- */
function testNoServiceAllActive() {
  const ctx = new ProjectContext(process.cwd());
  const summary = ctx.summarizeFiles(
    ['src/services/container.js', 'test/wave14-noise-env-test.js'],
    () => true
  );
  assert.strictEqual(summary.directoryRoles.active, 2, 'Without --service, files should be active');
  assert.strictEqual(summary.directoryRoles.reference, 0, 'Without --service, no reference files');
}

/* -------------------------------------------------------------------------- */
// Test 2: --service excludes reference files from CLI findings
/* -------------------------------------------------------------------------- */
function testServiceFiltersFindings() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-mono-dg-'));
  try {
    fs.mkdirSync(path.join(tmpDir, 'services', 'auth-service', 'src'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'services', 'user-service', 'src'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'libs', 'db'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'services', 'auth-service', 'package.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'services', 'user-service', 'package.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'libs', 'db', 'package.json'), '{}');

    const ctx = new ProjectContext(tmpDir, { service: 'services/auth-service' });

    const schema = {
      'services/auth-service/src/main.js': { imports: [], exports: ['auth'], originalPath: 'services/auth-service/src/main.js' },
      'services/user-service/src/main.js': { imports: [], exports: ['user'], originalPath: 'services/user-service/src/main.js' },
      'libs/db/index.js': { imports: [], exports: ['db'], originalPath: 'libs/db/index.js' },
    };

    const dg = DependencyGraph.fromSchema(tmpDir, schema, { projectContext: ctx });

    // shouldExcludeCli should filter reference files
    assert.strictEqual(dg.shouldExcludeCli('services/auth-service/src/main.js'), false, 'active file should not be excluded');
    assert.strictEqual(dg.shouldExcludeCli('services/user-service/src/main.js'), true, 'reference file should be excluded');
    assert.strictEqual(dg.shouldExcludeCli('libs/db/index.js'), true, 'reference lib file should be excluded');

    const dead = dg.findDeadExports({ skipCache: true });
    const userDead = dead.filter((d) => d.file && d.file.includes('user-service'));
    const libDead = dead.filter((d) => d.file && d.file.includes('libs/db'));

    assert.strictEqual(userDead.length, 0, 'reference dead exports should be excluded from findings');
    assert.strictEqual(libDead.length, 0, 'reference lib dead exports should be excluded from findings');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/* -------------------------------------------------------------------------- */
// Test 3: ProjectContext role classification with --service
/* -------------------------------------------------------------------------- */
function testProjectContextRoleClassification() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-mono-ctx-'));
  try {
    fs.mkdirSync(path.join(tmpDir, 'services', 'auth-service', 'src'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'services', 'user-service', 'src'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'libs', 'db'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'services', 'auth-service', 'package.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'services', 'user-service', 'package.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'libs', 'db', 'package.json'), '{}');

    const ctx = new ProjectContext(tmpDir, { service: 'services/auth-service' });

    const authClass = ctx.classifyDirectory('services/auth-service/src');
    assert.strictEqual(authClass.role, 'active', 'auth-service should be active');
    assert.strictEqual(authClass.matchedRule.source, 'service');

    const userClass = ctx.classifyDirectory('services/user-service/src');
    assert.strictEqual(userClass.role, 'reference', 'user-service should be reference');
    assert.strictEqual(userClass.matchedRule.source, 'service-downgrade');

    const libClass = ctx.classifyDirectory('libs/db');
    assert.strictEqual(libClass.role, 'reference', 'libs/db should be reference');
    assert.strictEqual(libClass.matchedRule.source, 'service-downgrade');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/* -------------------------------------------------------------------------- */
// Test 4: Invalid service path (path traversal)
/* -------------------------------------------------------------------------- */
function testInvalidServicePath() {
  const parsed = parseCliArgs(['node', 'cli.js', '--service', '../escape', 'audit-summary']);
  const root = process.cwd();
  const err = sanitizeCliPaths({ ...parsed, cwd: root });
  assert.ok(err, 'Expected validation error for escaped service path');
  assert.ok(err.error.includes('path traversal') || err.error.includes('escape'), `Expected traversal error, got: ${err.error}`);
}

/* -------------------------------------------------------------------------- */
// Test 5: Non-existent service path
/* -------------------------------------------------------------------------- */
function testNonExistentServicePath() {
  const parsed = parseCliArgs(['node', 'cli.js', '--service', 'does-not-exist', 'audit-summary']);
  const root = process.cwd();
  const err = sanitizeCliPaths({ ...parsed, cwd: root });
  assert.ok(err, 'Expected validation error for non-existent service path');
  assert.ok(err.error.includes('does not exist') || err.error.includes('inaccessible'), `Expected existence error, got: ${err.error}`);
}

/* -------------------------------------------------------------------------- */
// Test 6: classifyDirectory priority — cli/service > config > default
/* -------------------------------------------------------------------------- */
function testClassifyDirectoryPriority() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-prio-'));
  try {
    fs.mkdirSync(path.join(tmpDir, 'foo'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, '.workspace-bridge.json'), JSON.stringify({
      directories: { active: ['foo'] }
    }));

    // Without service, config wins
    const ctx1 = new ProjectContext(tmpDir);
    const c1 = ctx1.classifyDirectory('foo');
    assert.strictEqual(c1.role, 'active');
    assert.strictEqual(c1.matchedRule.source, 'config');

    // With --exclude, cli should override config
    const ctx2 = new ProjectContext(tmpDir, { excludeDirs: ['foo'] });
    const c2 = ctx2.classifyDirectory('foo');
    assert.strictEqual(c2.role, 'reference');
    assert.strictEqual(c2.matchedRule.source, 'cli');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/* -------------------------------------------------------------------------- */
// Runner
/* -------------------------------------------------------------------------- */
function run() {
  testNoServiceAllActive();
  testServiceFiltersFindings();
  testProjectContextRoleClassification();
  testInvalidServicePath();
  testNonExistentServicePath();
  testClassifyDirectoryPriority();
  console.log('wave14-monorepo-service-test: 6/6 passed');
}

run();
