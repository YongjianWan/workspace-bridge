#!/usr/bin/env node
// @fast
// @semantic
/**
 * `health` and the `health` section of `audit-summary` report what is actually in the
 * repository: a bare project does not score 5/5, and a well-kept one is not rated medium
 * because of invented missing checks.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeTempDir, cleanupTempDir, runCli } = require('./test-helpers');

function project(files) {
  const root = makeTempDir('wb-health-real-');
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'index.js'), 'module.exports = 1;\n');
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), content);
  }
  return root;
}

const bare = project({ 'package.json': '{"name":"bare"}\n' });
const kept = project({
  'package.json': '{"name":"kept","scripts":{"test":"jest"},"devDependencies":{"jest":"^29.0.0"}}\n',
  'README.md': '# kept\n',
  LICENSE: 'MIT\n',
  '.gitignore': 'node_modules\n',
  '.editorconfig': 'root = true\n',
  '.env.example': 'A=1\n',
  'Dockerfile': 'FROM node:22\n',
  '.github/workflows/ci.yml': 'name: ci\non: push\njobs: {}\n',
  'jest.config.js': 'module.exports = {};\n',
});
try {
  const run = (root, command) => runCli([command, '--cwd', root, '--json', '--quiet']);

  const bareHealth = run(bare, 'health');
  assert.strictEqual(bareHealth.checks.readme.found, false, 'no README in the project');
  assert.strictEqual(bareHealth.checks.license.found, false, 'no LICENSE in the project');
  assert.notStrictEqual(bareHealth.healthScore, '5/5');
  assert(bareHealth.healthScoreNumeric.ratio < 1);
  assert(bareHealth.fixes.length > 0, 'missing files come with fix suggestions');

  const bareSummary = run(bare, 'audit-summary');
  assert.strictEqual(bareSummary.health.checks.readme.found, false, 'audit-summary.health reflects the project');
  assert.strictEqual(bareSummary.summary.severity, 'medium', 'three or more missing hygiene checks rate the project medium');

  const keptHealth = run(kept, 'health');
  assert.strictEqual(keptHealth.checks.readme.found, true);
  assert.strictEqual(keptHealth.checks.ci.found, true);
  const keptSummary = run(kept, 'audit-summary');
  assert.strictEqual(keptSummary.summary.severity, 'low', 'a well-kept project is not rated medium by invented gaps');
  assert.strictEqual(keptSummary.health.healthScoreNumeric.passed, keptSummary.health.healthScoreNumeric.total);
} finally {
  cleanupTempDir(bare);
  cleanupTempDir(kept);
}
