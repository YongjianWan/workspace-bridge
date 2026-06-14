#!/usr/bin/env node
// @semantic

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { runCliInProcess, makeTempDir, cleanupTempDir } = require('./test-helpers');

async function main() {
  const tempRoot = makeTempDir('workspace-bridge-role-');

  function writeFile(relativePath, content) {
    const fullPath = path.join(tempRoot, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }

  writeFile('package.json', JSON.stringify({
    name: 'role-fixture',
    version: '1.0.0',
    main: 'src/index.js',
  }, null, 2));
writeFile('.workspace-bridge.json', JSON.stringify({
  directories: {
    reference: ['prototypes/reference'],
    archive: ['archive'],
  },
}, null, 2));
writeFile('src/index.js', "export function main() { return 'ok'; }\n");
writeFile('src/helper.js', "export function helper() { return 'helper'; }\n");
writeFile('prototypes/reference/sample.js', "export function sample() { return 'sample'; }\n");
writeFile('archive/old.js', "export function oldThing() { return 'old'; }\n");
writeFile('dist/bundle.js', "export function generated() { return 'generated'; }\n");

  try {
    const summary = await runCliInProcess(['audit-summary', '--cwd', tempRoot, '--json', '--quiet']);

  assert.strictEqual(summary.scope.hasWorkspaceBridgeConfig, true);
  assert.strictEqual(summary.scope.counts.totalFiles, 2);
  assert.strictEqual(summary.scope.counts.mainlineFiles, 2);
  assert.strictEqual(summary.scope.counts.nonMainlineFiles, 0);
  assert.strictEqual(summary.scope.counts.testFiles, 0);
  assert.strictEqual(summary.scope.directoryRoles.active, 2);
  assert.strictEqual(summary.scope.directoryRoles.reference, 0);
  assert.strictEqual(summary.scope.directoryRoles.archive, 0);
  assert.strictEqual(summary.scope.directoryRoles.generated, 0);
  assert(summary.scope.entryFiles.includes('src/index.js'));

  const deadExportFiles = summary.deadExports.deadExports.map((entry) => entry.file.replace(/\\/g, '/'));
  assert(deadExportFiles.some((file) => file.endsWith('/src/helper.js')));
  assert(deadExportFiles.every((file) => !file.includes('/prototypes/reference/')));
  assert(deadExportFiles.every((file) => !file.includes('/archive/')));

  // Auto-detect prototypes/examples as reference without config
  const autoRoot = makeTempDir('workspace-bridge-role-auto-');
  const writeAutoFile = (relativePath, content) => {
    const fullPath = path.join(autoRoot, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  };
  writeAutoFile('package.json', JSON.stringify({
    name: 'role-auto-fixture',
    version: '1.0.0',
    main: 'src/index.js',
  }, null, 2));
  writeAutoFile('src/index.js', "export function main() { return 'ok'; }\n");
  writeAutoFile('src/helper.js', "export function helper() { return 'helper'; }\n");
  writeAutoFile('prototypes/playground/foo.js', "export function foo() { return 'foo'; }\n");
  writeAutoFile('examples/demo/bar.js', "export function bar() { return 'bar'; }\n");

  const autoSummary = await runCliInProcess(['audit-summary', '--cwd', autoRoot, '--json', '--quiet']);
  assert.strictEqual(autoSummary.scope.hasWorkspaceBridgeConfig, false);
  assert.strictEqual(autoSummary.scope.counts.totalFiles, 2);
  assert.strictEqual(autoSummary.scope.counts.mainlineFiles, 2);
  assert.strictEqual(autoSummary.scope.counts.nonMainlineFiles, 0);
  assert.strictEqual(autoSummary.scope.counts.testFiles, 0);
  assert.strictEqual(autoSummary.scope.directoryRoles.active, 2);
  assert.strictEqual(autoSummary.scope.directoryRoles.reference, 0);
  assert.strictEqual(autoSummary.scope.directoryRoles.archive, 0);

  const autoDeadExportFiles = autoSummary.deadExports.deadExports.map((entry) => entry.file.replace(/\\/g, '/'));
  assert(autoDeadExportFiles.some((file) => file.endsWith('/src/helper.js')));
  assert(autoDeadExportFiles.every((file) => !file.includes('/prototypes/')));
  assert(autoDeadExportFiles.every((file) => !file.includes('/examples/')));
  cleanupTempDir(autoRoot);

  // Entry detection for framework/bootstrap files
  const entryRoot = makeTempDir('workspace-bridge-role-entry-');
  const writeEntryFile = (relativePath, content) => {
    const fullPath = path.join(entryRoot, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  };
  writeEntryFile('package.json', JSON.stringify({
    name: 'role-entry-fixture',
    version: '1.0.0',
    main: 'src/index.js',
  }, null, 2));
  writeEntryFile('src/index.js', "export function main() { return 'ok'; }\n");
  writeEntryFile('manage.py', '#!/usr/bin/env python\n');
  writeEntryFile('vite.config.ts', 'export default {};\n');
  const entrySummary = await runCliInProcess(['audit-summary', '--cwd', entryRoot, '--json', '--quiet']);
  assert(entrySummary.scope.entryFiles.includes('manage.py'));
  // L2-17: vite.config.ts is a config file, not an entry file
  assert(!entrySummary.scope.entryFiles.includes('vite.config.ts'));
  assert.strictEqual(entrySummary.scope.fileRoles.config, 1, 'vite.config.ts should be counted as config');
  cleanupTempDir(entryRoot);

  // P95: tests.py basename detection for Django projects
  const djangoRoot = makeTempDir('workspace-bridge-role-django-');
  const writeDjangoFile = (relativePath, content) => {
    const fullPath = path.join(djangoRoot, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  };
  writeDjangoFile('manage.py', '#!/usr/bin/env python\n');
  writeDjangoFile('core/tests.py', 'from django.test import TestCase\n');
  writeDjangoFile('core/models.py', 'from django.db import models\n');
  const djangoSummary = await runCliInProcess(['audit-summary', '--cwd', djangoRoot, '--json', '--quiet']);
  assert.strictEqual(djangoSummary.scope.fileRoles.test, 1, 'tests.py should be counted as test');
  assert.strictEqual(djangoSummary.scope.counts.testFiles, 1, 'tests.py should be counted in testFiles');
  cleanupTempDir(djangoRoot);

  // P100: root-level Python scripts should be classified as script
  const scriptRoot = makeTempDir('workspace-bridge-role-script-');
  const writeScriptFile = (relativePath, content) => {
    const fullPath = path.join(scriptRoot, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  };
  writeScriptFile('package.json', JSON.stringify({ name: 'role-script-fixture', version: '1.0.0' }, null, 2));
  writeScriptFile('fix_db_constraints.py', '# fix script\n');
  writeScriptFile('generate_sql.py', '# generate script\n');
  writeScriptFile('core/models.py', '# models\n');
  const scriptSummary = await runCliInProcess(['audit-summary', '--cwd', scriptRoot, '--json', '--quiet']);
  assert.strictEqual(scriptSummary.scope.fileRoles.script, 2, 'root-level .py files should be counted as script');
  // core/models.py is not imported by any file, so it becomes 'unknown' (orphan rule), not 'library'
  assert.strictEqual(scriptSummary.scope.fileRoles.unknown, 1, 'non-root unimported .py should be unknown');
  cleanupTempDir(scriptRoot);

  // Direct inferFileRole tests for config/script extensions
  const { ProjectContext } = require('../src/utils/project-context');
  const pc = new ProjectContext(tempRoot);
  assert.strictEqual(pc.classifyFile('pom.xml').fileRole, 'config', 'pom.xml should be config');
  assert.strictEqual(pc.classifyFile('application.yml').fileRole, 'config', 'application.yml should be config');
  assert.strictEqual(pc.classifyFile('db/schema.sql').fileRole, 'script', 'schema.sql should be script');
  assert.strictEqual(pc.classifyFile('settings.properties').fileRole, 'config', 'settings.properties should be config');
  assert.strictEqual(pc.classifyFile('nginx.conf').fileRole, 'config', 'nginx.conf should be config');

  // Non-standard dev directories should be recognized as test/non-mainline
  const devDirRoot = makeTempDir('workspace-bridge-role-devdir-');
  const writeDevFile = (relativePath, content) => {
    const fullPath = path.join(devDirRoot, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  };
  writeDevFile('package.json', JSON.stringify({ name: 'role-devdir-fixture', version: '1.0.0' }, null, 2));
  writeDevFile('src/index.js', "export function main() { return 'ok'; }\n");
  writeDevFile('benchmark/sort.js', "export function bench() {}\n");
  writeDevFile('e2e/login.spec.js', "export function testLogin() {}\n");
  writeDevFile('fixtures/users.json', JSON.stringify([]));
  writeDevFile('mocks/api.js', "export function mockApi() {}\n");

  const devPc = new ProjectContext(devDirRoot);
  const benchClass = devPc.classifyFile('benchmark/sort.js');
  assert.strictEqual(benchClass.fileRole, 'test', 'benchmark/ files should be classified as test');
  assert.strictEqual(benchClass.isMainline, false, 'benchmark/ files should not be mainline');

  const e2eClass = devPc.classifyFile('e2e/login.spec.js');
  assert.strictEqual(e2eClass.fileRole, 'test', 'e2e/ files should be classified as test');
  assert.strictEqual(e2eClass.isMainline, false, 'e2e/ files should not be mainline');

  const fixtureClass = devPc.classifyFile('fixtures/users.json');
  assert.strictEqual(fixtureClass.fileRole, 'test', 'fixtures/ files should be classified as test');
  assert.strictEqual(fixtureClass.isMainline, false, 'fixtures/ files should not be mainline');

  const mockClass = devPc.classifyFile('mocks/api.js');
  assert.strictEqual(mockClass.fileRole, 'test', 'mocks/ files should be classified as test');
  assert.strictEqual(mockClass.isMainline, false, 'mocks/ files should not be mainline');

  // Context-aware: excludeDirs should be respected even for unknown directories
  const excludePc = new ProjectContext(devDirRoot, { excludeDirs: ['vendor'] });
  const vendorClass = excludePc.classifyFile('vendor/lib.js');
  assert.strictEqual(vendorClass.directoryRole, 'reference', 'excludeDirs should classify as reference');
  assert.strictEqual(vendorClass.isMainline, false, 'excludeDirs should make isMainline false');

  cleanupTempDir(devDirRoot);
  } finally {
    cleanupTempDir(tempRoot);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
