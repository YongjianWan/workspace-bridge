#!/usr/bin/env node
// @fast
// @semantic
/**
 * A value that is null (coverageRatio when discovery was incomplete) is written as `null` in the
 * stats text and markdown output, not as an empty string that reads like a missing field or 100%.
 */
const assert = require('assert');
const { formatCliResult } = require('../src/cli/route-formatter');

const result = {
  ok: true,
  stats: {
    files: 3,
    analysisCoverage: { discoveryComplete: false, totalFiles: 3, coverageRatio: null },
    nothing: undefined,
  },
};
for (const format of ['markdown', 'text']) {
  const out = formatCliResult({ format, command: 'stats' }, result);
  assert(/coverageRatio=null/.test(out), `${format} output must spell out null:\n${out}`);
  assert(!/coverageRatio=(,|\s|$)/m.test(out), `${format} output must not leave the value empty`);
}
