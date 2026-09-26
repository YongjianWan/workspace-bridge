#!/usr/bin/env node
// @semantic
const assert = require('assert');
const { parseJavaScript } = require('../src/services/dep-graph/parsers/js');

const parsed = parseJavaScript(
  'import type { T } from "./types";\nexport const v: T = 1;\n',
  '/workspace/main.ts',
);
assert(parsed.imports.includes('./types'), 'type import must name a structural dependency');
const record = parsed.importRecords.find((item) => item.source === './types');
assert(record, 'type import must have an import record');
assert.strictEqual(record.isTypeOnly, true, 'record must retain type-only semantics');
assert(record.imported.includes('T'), 'type symbol usage must remain visible');
