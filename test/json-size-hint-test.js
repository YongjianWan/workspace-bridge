#!/usr/bin/env node
// @fast
// @semantic
/**
 * A --json document past the size threshold says how to get a smaller one; small documents are untouched.
 */
const assert = require('assert');
const { formatCliResult } = require('../src/cli/route-formatter');
const { LIMITS } = require('../src/config/constants');

const parsed = { command: 'impact', json: true };
const small = JSON.parse(formatCliResult(parsed, { ok: true, items: ['a'] }));
assert.strictEqual(small.sizeHint, undefined, 'small output has no hint');

const text = 'x'.repeat(200);
const items = Array.from({ length: Math.ceil(LIMITS.JSON_SIZE_HINT_BYTES / 200) + 50 }, () => text);
const big = JSON.parse(formatCliResult({ ...parsed, maxFiles: items.length }, { ok: true, items }));
assert(big.sizeHint && /--format ai/.test(big.sizeHint) && /--fields/.test(big.sizeHint), 'large output names the smaller alternatives');
