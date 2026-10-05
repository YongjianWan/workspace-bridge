// @semantic
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildValidationAdvice } = require('../src/tools/summaries/validation-advice');
const { classifyChangeType } = require('../src/tools/summaries/audit-diff-summary');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

const root = makeTempDir('wb-generated-validation-');
const entry = (file, directoryRole = 'source', fileRole = 'library') => ({
  file, graphKnown: false, impactCount: 0, affectedTestsCount: 0,
  classification: { directoryRole, fileRole, isMainline: directoryRole === 'source' },
});
try {
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture', scripts: { test: 'jest' }, devDependencies: { eslint: '*', jest: '*' } }));
  fs.mkdirSync(path.join(root, 'artifacts'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src/live.js'), 'exports.live = 1;');
  const extensions = ['ts', 'py', 'java', 'kt', 'go', 'rs', 'cpp', 'vue', 'svelte'];
  for (const ext of extensions) {
    const generated = entry(`artifacts/out.${ext}`, 'generated');
    fs.writeFileSync(path.join(root, generated.file), 'generated fixture');
    assert.strictEqual(classifyChangeType([generated]), 'docs', `${ext}: generated-only uses the existing non-mainline review template`);
    assert.strictEqual(classifyChangeType([generated, entry('README.md', 'source', 'docs')]), 'docs', `${ext}: generated files must not outweigh documentation`);
    const advice = buildValidationAdvice([generated], root);
    assert.strictEqual(advice.changeType, 'docs');
    assert(Object.values(advice.commands).flat().every((command) => ['git-diff-check', 'mixed-review'].includes(command.name)), 'only whitespace checks and review reminders may remain');
    const mixed = buildValidationAdvice([generated, entry('src/live.js')], root);
    assert.strictEqual(mixed.changeType, 'code', 'real source changes still require code validation');
    assert(!JSON.stringify(mixed.commands).includes(generated.file), 'generated artifact must not be passed to source validators');
    assert(JSON.stringify(mixed.commands).includes('live.js'), 'source target remains in validation commands');
    assert(!mixed.phases.some((phase) => phase.targets.includes(generated.file)), 'generated artifact must not become a code validation target');
  }
  assert.strictEqual(classifyChangeType([entry('src/test.js', 'source', 'test')]), 'tests');
  console.log('generated-validation-test: all passed');
} finally { cleanupTempDir(root); }
