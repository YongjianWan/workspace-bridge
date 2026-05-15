#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { buildChecks } = require('../src/tools/workspace-tools');
const { detectWorkspace } = require('../src/utils/path');

async function testBuildChecksDetectsEslintConfigInPackageJson() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-diag-'));
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

  fs.rmSync(tmpDir, { recursive: true, force: true });
}

async function testBuildChecksDetectsDotEslintrc() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-diag-'));
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

  fs.rmSync(tmpDir, { recursive: true, force: true });
}

async function main() {
  await testBuildChecksDetectsEslintConfigInPackageJson();
  await testBuildChecksDetectsDotEslintrc();
  console.log('workspace-tools-test: all passed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
