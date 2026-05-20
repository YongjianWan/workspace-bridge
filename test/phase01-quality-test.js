#!/usr/bin/env node
// @slow
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { getChangedFiles } = require('../src/tools/git-tools');
const { ProjectContext } = require('../src/utils/project-context');
const { detectStack } = require('../src/utils/stack-detector');
const { DependencyGraph } = require('../src/services/dep-graph');
const { detectTestConfig } = require('../src/tools/health-tools');
const { classifyChangeType } = require('../src/cli/formatters');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

async function testTempFileFilter() {
  const tmpDir = makeTempDir('wb-temp-');
  fs.writeFileSync(path.join(tmpDir, 'cache.db'), 'sqlite');
  fs.writeFileSync(path.join(tmpDir, 'real-file.js'), 'console.log(1);');

  spawnSync('git', ['init'], { cwd: tmpDir });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpDir });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: tmpDir });

  const result = await getChangedFiles(tmpDir, { staged: false, includeUntracked: true });
  const names = result.changedFiles.map((f) => path.basename(f));
  assert(!names.includes('cache.db'), 'should filter cache db files');
  assert(names.includes('real-file.js'), 'should keep real files');

  cleanupTempDir(tmpDir);
}

async function testTempFileFilterStaged() {
  const tmpDir = makeTempDir('wb-temp-staged-');
  fs.writeFileSync(path.join(tmpDir, 'cache.db'), 'sqlite');
  fs.writeFileSync(path.join(tmpDir, 'real-file.js'), 'console.log(1);');

  spawnSync('git', ['init'], { cwd: tmpDir });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpDir });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: tmpDir });
  spawnSync('git', ['add', '.'], { cwd: tmpDir });

  const result = await getChangedFiles(tmpDir, { staged: true, includeUntracked: false });
  const names = result.changedFiles.map((f) => path.basename(f));
  assert(!names.includes('cache.db'), 'staged mode should filter cache db files');
  assert(names.includes('real-file.js'), 'staged mode should keep real files');

  cleanupTempDir(tmpDir);
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
    '.claude/settings.local.json',
  ];
  for (const name of configCases) {
    const role = ctx.classifyFile(path.join(process.cwd(), name)).fileRole;
    assert.strictEqual(role, 'config', `${name} should be config, got ${role}`);
  }
}

function testCustomTestScriptDetection() {
  const tmpDir = makeTempDir('wb-testscript-');
  fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ scripts: { 'test:all': 'node test/*.js', build: 'tsc' } }));

  const stack = detectStack(tmpDir);
  assert(stack.node?.testRunner, 'should detect test runner from custom test:* script');

  cleanupTempDir(tmpDir);
}

function testDetectTestConfigFromPackageJson() {
  const tmpDir = makeTempDir('wb-testconfig-');
  fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ scripts: { test: 'node test/*.js', build: 'tsc' } }));

  const result = detectTestConfig(tmpDir);
  assert.strictEqual(result.found, true, 'should detect test config from package.json scripts.test');
  assert(result.frameworks.includes('custom-node-scripts'), 'should include custom-node-scripts framework');

  cleanupTempDir(tmpDir);
}

function testEntryFileNormalization() {
  const tmpDir = makeTempDir('wb-entry-');
  fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ main: 'cli.js', bin: { app: 'cli.js' } }));

  const graph = new DependencyGraph(tmpDir, { fileMetadata: new Map() }, { projectContext: new ProjectContext(tmpDir) });

  const entryFiles = Array.from(graph.entryFiles || []);
  const hasCli = entryFiles.some((f) => f.includes('cli.js'));
  assert(hasCli, `entryFiles should include cli.js, got ${entryFiles.join(', ')}`);

  cleanupTempDir(tmpDir);
}

function testClassifyChangeTypeDocsDominant() {
  // docs 占主导且没有 code/tests → 返回 docs
  const docsDominant = [
    { file: 'README.md', classification: { fileRole: 'docs' } },
    { file: 'AGENTS.md', classification: { fileRole: 'docs' } },
    { file: 'docs/guide.md', classification: { fileRole: 'docs' } },
    { file: '.claude/settings.local.json', classification: { fileRole: 'config' } },
  ];
  assert.strictEqual(classifyChangeType(docsDominant), 'docs', 'docs dominant should return docs');

  // 纯 docs
  const pureDocs = [
    { file: 'README.md', classification: { fileRole: 'docs' } },
    { file: 'CHANGELOG.md', classification: { fileRole: 'docs' } },
  ];
  assert.strictEqual(classifyChangeType(pureDocs), 'docs', 'pure docs should return docs');

  // 纯 config
  const pureConfig = [
    { file: 'package.json', classification: { fileRole: 'config' } },
    { file: 'tsconfig.json', classification: { fileRole: 'config' } },
  ];
  assert.strictEqual(classifyChangeType(pureConfig), 'config', 'pure config should return config');

  // 有 code 时不应被 docs 主导
  const withCode = [
    { file: 'src/index.js', classification: { fileRole: 'library' } },
    { file: 'README.md', classification: { fileRole: 'docs' } },
  ];
  assert.strictEqual(classifyChangeType(withCode), 'code', 'code + docs should return code');

  // 有 tests 时不应被 docs 主导
  const withTests = [
    { file: 'test/index.test.js', classification: { fileRole: 'test' } },
    { file: 'README.md', classification: { fileRole: 'docs' } },
    { file: 'docs/guide.md', classification: { fileRole: 'docs' } },
  ];
  assert.strictEqual(classifyChangeType(withTests), 'tests', 'tests + docs should return tests');
}

function testClassifyChangeTypeFileRoleFallback() {
  // library + ext fallback
  assert.strictEqual(
    classifyChangeType([{ file: 'README.md', classification: { fileRole: 'library' } }]),
    'docs',
    'library + md should fallback to docs'
  );
  assert.strictEqual(
    classifyChangeType([{ file: 'package-lock.json', classification: { fileRole: 'library' } }]),
    'config',
    'library + json should fallback to config'
  );
  assert.strictEqual(
    classifyChangeType([{ file: 'src/index.js', classification: { fileRole: 'library' } }]),
    'code',
    'library + js should fallback to code'
  );

  // fileRole direct mapping
  assert.strictEqual(
    classifyChangeType([{ file: 'cli.js', classification: { fileRole: 'entry' } }]),
    'code',
    'entry should map to code'
  );
  assert.strictEqual(
    classifyChangeType([{ file: 'migrations/001.js', classification: { fileRole: 'migration' } }]),
    'code',
    'migration should map to code'
  );
  assert.strictEqual(
    classifyChangeType([{ file: 'deploy.sh', classification: { fileRole: 'script' } }]),
    'scripts',
    'script should map to scripts'
  );

  // mixed: code priority over docs/config
  const mixedCode = [
    { file: 'src/index.js', classification: { fileRole: 'library' } },
    { file: 'README.md', classification: { fileRole: 'library' } },
    { file: 'tsconfig.json', classification: { fileRole: 'library' } },
  ];
  assert.strictEqual(classifyChangeType(mixedCode), 'code', 'code should win over docs and config');
}

async function main() {
  await testTempFileFilter();
  await testTempFileFilterStaged();
  testFileRoleDocs();
  testFileRoleConfig();
  testCustomTestScriptDetection();
  testDetectTestConfigFromPackageJson();
  testEntryFileNormalization();
  testClassifyChangeTypeDocsDominant();
  testClassifyChangeTypeFileRoleFallback();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
