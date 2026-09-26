#!/usr/bin/env node
// @semantic
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildValidationAdvice } = require('../src/cli/formatters/validation-advice');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-validation-deleted-'));
try {
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"fixture","devDependencies":{"eslint":"*"}}');
  fs.writeFileSync(path.join(root, 'eslint.config.js'), 'module.exports = [];\n');
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'live.js'), 'module.exports = 1;\n');

  const entry = (file) => ({
    file,
    graphKnown: true,
    impactCount: 0,
    affectedTestsCount: 0,
    classification: { isMainline: true },
    compositeRisk: { level: 'low', score: 0 },
    historyRisk: { level: 'low' },
  });
  const advice = buildValidationAdvice([entry('src/live.js'), entry('src/gone.js')], root);
  const commands = JSON.stringify(advice.commands);
  assert(commands.includes('live.js'), 'existing changed file should remain in lint command');
  assert(!commands.includes('gone.js'), 'deleted changed file must not be passed to a command');
  assert(advice.phases[0].targets.includes('src/gone.js'), 'deleted change should remain visible in the plan');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
