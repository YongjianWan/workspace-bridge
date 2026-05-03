#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..');
const cliPath = path.join(repoRoot, 'cli.js');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-bridge-role-'));

function writeFile(relativePath, content) {
  const fullPath = path.join(tempRoot, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

function runCli(args) {
  const result = spawnSync('node', [cliPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
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
  const summary = runCli(['audit-summary', '--cwd', tempRoot, '--json', '--quiet']);

  assert.strictEqual(summary.scope.hasConfig, true);
  assert.strictEqual(summary.scope.counts.totalFiles, 4);
  assert.strictEqual(summary.scope.counts.mainlineFiles, 2);
  assert.strictEqual(summary.scope.counts.nonMainlineFiles, 2);
  assert.strictEqual(summary.scope.directoryRoles.active, 2);
  assert.strictEqual(summary.scope.directoryRoles.reference, 1);
  assert.strictEqual(summary.scope.directoryRoles.archive, 1);
  assert.strictEqual(summary.scope.directoryRoles.generated, 0);
  assert(summary.scope.entryFiles.includes('src/index.js'));

  const deadExportFiles = summary.deadExports.deadExports.map((entry) => entry.file.replace(/\\/g, '/'));
  assert(deadExportFiles.some((file) => file.endsWith('/src/helper.js')));
  assert(deadExportFiles.every((file) => !file.includes('/prototypes/reference/')));
  assert(deadExportFiles.every((file) => !file.includes('/archive/')));

  // Auto-detect prototypes/examples as reference without config
  const autoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-bridge-role-auto-'));
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

  const autoSummary = runCli(['audit-summary', '--cwd', autoRoot, '--json', '--quiet']);
  assert.strictEqual(autoSummary.scope.hasConfig, false);
  assert.strictEqual(autoSummary.scope.counts.totalFiles, 4);
  assert.strictEqual(autoSummary.scope.counts.mainlineFiles, 2);
  assert.strictEqual(autoSummary.scope.counts.nonMainlineFiles, 2);
  assert.strictEqual(autoSummary.scope.directoryRoles.active, 2);
  assert.strictEqual(autoSummary.scope.directoryRoles.reference, 1);
  assert.strictEqual(autoSummary.scope.directoryRoles.archive, 1);

  const autoDeadExportFiles = autoSummary.deadExports.deadExports.map((entry) => entry.file.replace(/\\/g, '/'));
  assert(autoDeadExportFiles.some((file) => file.endsWith('/src/helper.js')));
  assert(autoDeadExportFiles.every((file) => !file.includes('/prototypes/')));
  assert(autoDeadExportFiles.every((file) => !file.includes('/examples/')));
  fs.rmSync(autoRoot, { recursive: true, force: true });

  // Entry detection for framework/bootstrap files
  const entryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-bridge-role-entry-'));
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
  const entrySummary = runCli(['audit-summary', '--cwd', entryRoot, '--json', '--quiet']);
  assert(entrySummary.scope.entryFiles.includes('manage.py'));
  assert(entrySummary.scope.entryFiles.includes('vite.config.ts'));
  fs.rmSync(entryRoot, { recursive: true, force: true });

  console.log('role-detection-test: ok');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
