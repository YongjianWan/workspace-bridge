#!/usr/bin/env node
// @fast
// @semantic
/**
 * The text tree must grow with the number of files, not the number of paths: a file reached
 * through several routes is expanded once, and a very large tree is cut with a hint.
 */
const assert = require('assert');
const { formatHuman, formatMarkdown } = require('../src/cli/formatters');
const { LIMITS } = require('../src/config/constants');

const leaf = { file: 'shared.js', imports: [{ file: 'deep-a.js' }, { file: 'deep-b.js' }] };
const tree = {
  imports: [
    { file: 'one.js', imports: [leaf] },
    { file: 'two.js', imports: [leaf] },
    { file: 'three.js', imports: [leaf] },
  ],
};
const result = { ok: true, file: 'root.js', tree };

for (const [name, format] of [['human', formatHuman], ['markdown', formatMarkdown]]) {
  const out = format('tree', result, {});
  assert.strictEqual(out.split('shared.js').length - 1, 3, `${name}: every parent still lists shared.js`);
  assert.strictEqual(out.split('deep-a.js').length - 1, 1, `${name}: the subtree of shared.js is expanded once`);
  assert.strictEqual(out.split('(see above)').length - 1, 2, `${name}: repeats point back to the first expansion`);
}

const wide = { ok: true, file: 'root.js', tree: { imports: Array.from({ length: LIMITS.TREE_TEXT_MAX_LINES + 50 }, (_, i) => ({ file: `f${i}.js` })) } };
const capped = formatHuman('tree', wide, {});
assert.strictEqual(capped.split('\n').length, 1 + LIMITS.TREE_TEXT_MAX_LINES + 1, 'cut at the cap plus one hint line');
assert(/50 more lines not shown/.test(capped) && /--max-files/.test(capped), 'the hint says how many lines and how to widen');
assert.strictEqual(formatHuman('tree', wide, { maxFiles: 1000 }).split('\n').length, 1 + LIMITS.TREE_TEXT_MAX_LINES + 50, '--max-files lifts the cap');
