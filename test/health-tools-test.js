#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { projectHealth } = require('../src/tools/health-tools');

async function testHealthScoreNumeric() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-health-'));
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

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('testHealthScoreNumeric passed');
}

async function main() {
  await testHealthScoreNumeric();
  console.log('All health-tools tests passed');
}

main().catch((e) => { console.error(e); process.exit(1); });
