#!/usr/bin/env node
// @semantic
const assert = require('assert');
const os = require('os');
const path = require('path');
const { ProjectContext } = require('../src/utils/project-context');
const { classifyChangeType } = require('../src/cli/formatters/audit-diff-summary');

const root = path.join(os.tmpdir(), 'wb-p2-4-virtual-workspace');
const context = new ProjectContext(root);
const classify = (file) => context.classifyFile(path.join(root, file));

for (const ext of ['js', 'ts', 'py', 'java', 'kt', 'go', 'rs', 'cpp', 'vue', 'svelte']) {
  assert.strictEqual(classify(`src/tools/helper.${ext}`).fileRole, 'library', `src/tools must be source code for .${ext}`);
}
assert.strictEqual(classify('tools/release.js').fileRole, 'script', 'root tools directory remains a script directory');
assert.strictEqual(classify('packages/demo/tools/generate.ts').fileRole, 'script', 'nested standalone tools remain scripts');

const changed = [
  ...Array.from({ length: 6 }, (_, i) => `src/tools/tool-${i}.js`),
  ...Array.from({ length: 3 }, (_, i) => `src/services/service-${i}.js`),
  'cli.js',
  ...Array.from({ length: 14 }, (_, i) => `test/case-${i}.test.js`),
  ...Array.from({ length: 5 }, (_, i) => `docs/note-${i}.md`),
].map((file) => ({ file, classification: classify(file) }));

assert.strictEqual(changed.length, 29);
assert.strictEqual(classifyChangeType(changed), 'code', 'a source-heavy change must get code validation advice');
console.log('p2-4-change-type-test: PASS');
