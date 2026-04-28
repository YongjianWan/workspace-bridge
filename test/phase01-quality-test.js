#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const { getChangedFiles } = require('../src/tools/git-tools');
const { ProjectContext } = require('../src/utils/project-context');
const { detectStack } = require('../src/utils/stack-detector');
const { DependencyGraph } = require('../src/services/dep-graph');

async function testTempFileFilter() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-temp-'));
  fs.writeFileSync(path.join(tmpDir, '.tmp-audit-summary.json'), '{}');
  fs.writeFileSync(path.join(tmpDir, '.workspace-bridge-cache.json.tmp-123'), '{}');
  fs.writeFileSync(path.join(tmpDir, 'real-file.js'), 'console.log(1);');

  spawnSync('git', ['init'], { cwd: tmpDir });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpDir });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: tmpDir });

  const result = await getChangedFiles(tmpDir, { staged: false, includeUntracked: true });
  assert.strictEqual(result.ok, true);
  const names = result.changedFiles.map((f) => path.basename(f));
  assert(!names.includes('.tmp-audit-summary.json'), 'should filter .tmp-* files');
  assert(!names.includes('.workspace-bridge-cache.json.tmp-123'), 'should filter cache tmp files');
  assert(names.includes('real-file.js'), 'should keep real files');

  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function testFileRoleDocs() {
  const ctx = new ProjectContext(process.cwd());
  const docsCases = ['README.md', 'AGENTS.md', 'CHANGELOG.md', 'LICENSE', 'CONTRIBUTING.md'];
  for (const name of docsCases) {
    const role = ctx.classifyFile(path.join(process.cwd(), name)).fileRole;
    assert.strictEqual(role, 'docs', `${name} should be docs, got ${role}`);
  }
}

function testFileRoleConfig() {
  const ctx = new ProjectContext(process.cwd());
  const configCases = [
    'package.json', 'tsconfig.json', '.editorconfig', '.gitignore',
    '.babelrc', '.npmrc', 'docker-compose.yml', 'Makefile',
  ];
  for (const name of configCases) {
    const role = ctx.classifyFile(path.join(process.cwd(), name)).fileRole;
    assert.strictEqual(role, 'config', `${name} should be config, got ${role}`);
  }
}

function testCustomTestScriptDetection() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-testscript-'));
  fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ scripts: { 'test:all': 'node test/*.js', build: 'tsc' } }));

  const stack = detectStack(tmpDir);
  assert(stack.node?.testRunner, 'should detect test runner from custom test:* script');

  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function testEntryFileNormalization() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-entry-'));
  fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ main: 'cli.js', bin: { app: 'cli.js' } }));

  const graph = new DependencyGraph(tmpDir, { fileMetadata: new Map() }, { projectContext: new ProjectContext(tmpDir) });

  const entryFiles = Array.from(graph.entryFiles || []);
  const hasCli = entryFiles.some((f) => f.includes('cli.js'));
  assert(hasCli, `entryFiles should include cli.js, got ${entryFiles.join(', ')}`);

  fs.rmSync(tmpDir, { recursive: true, force: true });
}

async function main() {
  await testTempFileFilter();
  testFileRoleDocs();
  testFileRoleConfig();
  testCustomTestScriptDetection();
  testEntryFileNormalization();
  console.log('phase01-quality-test: ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
