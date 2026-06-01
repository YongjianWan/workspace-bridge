#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { buildChecks, workspaceInfo, detectNodeLinters } = require('../src/tools/workspace-tools');
const { detectWorkspace } = require('../src/utils/path');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

async function testBuildChecksDetectsEslintConfigInPackageJson() {
  const tmpDir = makeTempDir('wb-diag-');
  fs.writeFileSync(
    path.join(tmpDir, 'package.json'),
    JSON.stringify({
      name: 'test',
      scripts: {},
      eslintConfig: { extends: ['eslint:recommended'] },
    }),
    'utf8'
  );

  const workspace = detectWorkspace(tmpDir);
  const { checks, noLintersDetected } = await buildChecks(workspace, 'quick');

  const eslintCheck = checks.find((c) => c.name === 'node:eslint');
  assert(eslintCheck, 'should detect eslint when package.json has eslintConfig');
  assert.strictEqual(noLintersDetected, false, 'noLintersDetected should be false when eslintConfig exists');

  cleanupTempDir(tmpDir);
}

async function testBuildChecksDetectsDotEslintrc() {
  const tmpDir = makeTempDir('wb-diag-');
  fs.writeFileSync(
    path.join(tmpDir, 'package.json'),
    JSON.stringify({ name: 'test', scripts: {} }),
    'utf8'
  );
  fs.writeFileSync(path.join(tmpDir, '.eslintrc'), '{ "extends": "eslint:recommended" }', 'utf8');

  const workspace = detectWorkspace(tmpDir);
  const { checks, noLintersDetected } = await buildChecks(workspace, 'quick');

  const eslintCheck = checks.find((c) => c.name === 'node:eslint');
  assert(eslintCheck, 'should detect eslint when .eslintrc exists');
  assert.strictEqual(noLintersDetected, false);

  cleanupTempDir(tmpDir);
}

function testDetectNodeLintersNoConfig() {
  const tmpDir = makeTempDir('wb-lint-');
  fs.writeFileSync(
    path.join(tmpDir, 'package.json'),
    JSON.stringify({ name: 'test', scripts: {} }),
    'utf8'
  );

  const workspace = detectWorkspace(tmpDir);
  const linters = detectNodeLinters(workspace, tmpDir);

  assert.strictEqual(linters.eslint, false, 'no eslint config');
  assert.strictEqual(linters.prettier, false, 'no prettier config');
  assert.strictEqual(linters.tsc, false, 'no tsconfig');

  cleanupTempDir(tmpDir);
}

function testDetectNodeLintersPrettierConfig() {
  const tmpDir = makeTempDir('wb-lint-');
  fs.writeFileSync(
    path.join(tmpDir, 'package.json'),
    JSON.stringify({ name: 'test', scripts: {} }),
    'utf8'
  );
  fs.writeFileSync(path.join(tmpDir, '.prettierrc'), '{ "semi": true }', 'utf8');

  const workspace = detectWorkspace(tmpDir);
  const linters = detectNodeLinters(workspace, tmpDir);

  assert.strictEqual(linters.prettier, true, '.prettierrc should be detected');
  assert.strictEqual(linters.eslint, false);

  cleanupTempDir(tmpDir);
}

function testWorkspaceInfoAvailableChecksReflectsActualLinters() {
  const tmpDir = makeTempDir('wb-lint-');
  fs.writeFileSync(
    path.join(tmpDir, 'package.json'),
    JSON.stringify({ name: 'test', scripts: {} }),
    'utf8'
  );

  const info = workspaceInfo({ cwd: tmpDir }, null);
  assert(info.availableChecks.includes('npm scripts'), 'should always include npm scripts');
  assert(!info.availableChecks.includes('eslint'), 'should not include eslint when no config');
  assert(!info.availableChecks.includes('prettier'), 'should not include prettier when no config');
  assert(!info.availableChecks.includes('tsc'), 'should not include tsc when no tsconfig');

  cleanupTempDir(tmpDir);
}

function testWorkspaceInfoAvailableChecksWithEslint() {
  const tmpDir = makeTempDir('wb-lint-');
  fs.writeFileSync(
    path.join(tmpDir, 'package.json'),
    JSON.stringify({ name: 'test', scripts: {}, eslintConfig: {} }),
    'utf8'
  );

  const info = workspaceInfo({ cwd: tmpDir }, null);
  assert(info.availableChecks.includes('eslint'), 'should include eslint when eslintConfig exists');
  assert.strictEqual(info.availableChecks.filter(c => c === 'eslint').length, 1, 'eslint should appear exactly once');

  cleanupTempDir(tmpDir);
}

async function testBuildChecksEslintWithoutScriptsField() {
  const tmpDir = makeTempDir('wb-diag-');
  fs.writeFileSync(
    path.join(tmpDir, 'package.json'),
    JSON.stringify({
      name: 'test',
      eslintConfig: { extends: ['eslint:recommended'] },
    }),
    'utf8'
  );

  const workspace = detectWorkspace(tmpDir);
  const { checks, noLintersDetected } = await buildChecks(workspace, 'quick');

  const eslintCheck = checks.find((c) => c.name === 'node:eslint');
  assert(eslintCheck, 'should detect eslint when package.json has no scripts field but eslintConfig exists');
  assert.strictEqual(noLintersDetected, false, 'noLintersDetected should be false when eslintConfig exists even without scripts field');

  cleanupTempDir(tmpDir);
}

async function testBuildChecksAllChecksHaveTimeout() {
  const tmpDir = makeTempDir('wb-diag-timeout-');
  fs.writeFileSync(
    path.join(tmpDir, 'package.json'),
    JSON.stringify({
      name: 'test',
      scripts: {
        typecheck: 'tsc --noEmit',
        lint: 'eslint .',
        build: 'npm run compile',
        test: 'jest',
      },
    }),
    'utf8'
  );
  fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), '{}', 'utf8');
  fs.writeFileSync(path.join(tmpDir, 'requirements.txt'), 'django', 'utf8');
  fs.writeFileSync(path.join(tmpDir, 'manage.py'), '# django manage.py', 'utf8');

  const workspace = detectWorkspace(tmpDir);
  const { checks } = await buildChecks(workspace, 'full');

  for (const check of checks) {
    assert(Number.isFinite(check.timeout), `check "${check.name}" must have a finite timeout`);
    assert(check.timeout > 0, `check "${check.name}" timeout must be positive`);
  }

  cleanupTempDir(tmpDir);
}

async function main() {
  await testBuildChecksDetectsEslintConfigInPackageJson();
  await testBuildChecksDetectsDotEslintrc();
  await testBuildChecksEslintWithoutScriptsField();
  testDetectNodeLintersNoConfig();
  testDetectNodeLintersPrettierConfig();
  testWorkspaceInfoAvailableChecksReflectsActualLinters();
  testWorkspaceInfoAvailableChecksWithEslint();
  await testBuildChecksAllChecksHaveTimeout();
  }

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
