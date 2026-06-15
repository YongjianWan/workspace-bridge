#!/usr/bin/env node
// @semantic

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { projectHealth } = require('../src/tools/audit-assembler');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

async function testHealthScoreNumeric() {
  const tmpDir = makeTempDir('wb-health-');
  fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}', 'utf8');
  fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Test', 'utf8');
  fs.writeFileSync(path.join(tmpDir, 'LICENSE'), 'MIT', 'utf8');
  fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'node_modules', 'utf8');

  const health = await projectHealth({ cwd: tmpDir }, null);

  assert.strictEqual(typeof health.healthScore, 'string', 'healthScore should be a string');
  assert(health.healthScore.includes('/'), 'healthScore should be a fraction string');

  assert(health.healthScoreNumeric, 'healthScoreNumeric should be present');
  assert.strictEqual(typeof health.healthScoreNumeric.passed, 'number', 'healthScoreNumeric.passed should be a number');
  assert.strictEqual(typeof health.healthScoreNumeric.total, 'number', 'healthScoreNumeric.total should be a number');
  assert.strictEqual(typeof health.healthScoreNumeric.ratio, 'number', 'healthScoreNumeric.ratio should be a number');
  assert(Number.isFinite(health.healthScoreNumeric.ratio), 'healthScoreNumeric.ratio should be finite');
  assert(health.healthScoreNumeric.ratio >= 0 && health.healthScoreNumeric.ratio <= 1, 'healthScoreNumeric.ratio should be in [0,1]');

  // Consistency: string and numeric should match
  const [passedStr, totalStr] = health.healthScore.split('/');
  assert.strictEqual(health.healthScoreNumeric.passed, Number(passedStr));
  assert.strictEqual(health.healthScoreNumeric.total, Number(totalStr));
  assert.strictEqual(health.healthScoreNumeric.ratio, Number(passedStr) / Number(totalStr));

  cleanupTempDir(tmpDir);
}

async function testDjangoTestConfigDetection() {
  const tmpDir = makeTempDir('wb-health-django-');
  fs.writeFileSync(path.join(tmpDir, 'manage.py'), '#!/usr/bin/env python\n', 'utf8');
  fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Test', 'utf8');
  fs.writeFileSync(path.join(tmpDir, 'LICENSE'), 'MIT', 'utf8');
  fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'node_modules', 'utf8');

  const health = await projectHealth({ cwd: tmpDir }, null);

  // P101: Django projects should have testConfig found via manage.py
  assert.strictEqual(health.checks.testConfig.found, true, 'Django project with manage.py should have testConfig found');
  assert(health.checks.testConfig.frameworks.includes('django-test'), 'testConfig frameworks should include django-test');

  cleanupTempDir(tmpDir);
}

async function main() {
  await testHealthScoreNumeric();
  await testDjangoTestConfigDetection();
  }

main().catch((e) => { console.error(e); process.exit(1); });
