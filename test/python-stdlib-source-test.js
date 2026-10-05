#!/usr/bin/env node
// @fast
// @semantic
/**
 * The Python standard-library name list decides which imports count as third-party. Where the
 * list came from (the interpreter, or the built-in fallback) and which interpreter version
 * produced it is part of the output, so a result is never silently based on a guess.
 */
const assert = require('assert');
const {
  getPythonStdlibInfo,
  peekPythonStdlibInfo,
  resetPythonStdlibMemo,
  PYTHON_STDLIB_FALLBACK,
} = require('../src/services/dep-graph/resolvers/python-stdlib');
const { REASON_CODES } = require('../src/services/ledger');
const { createMockDepGraph } = require('./test-helpers');

assert(REASON_CODES['python-stdlib-fallback'], 'the fallback has a reason code');

// Not consulted yet: nothing to report, and looking does not start an interpreter.
resetPythonStdlibMemo();
assert.strictEqual(peekPythonStdlibInfo(), null);

// The interpreter answered.
let info = getPythonStdlibInfo('/repo', () => ({ names: new Set(['os', 'sys']), version: '3.12.3' }));
assert.strictEqual(info.source, 'interpreter');
assert.strictEqual(info.version, '3.12.3');
assert(info.names.has('os'));
assert.strictEqual(peekPythonStdlibInfo(), info, 'the answer is remembered for the process');

// The interpreter is missing or failed: the built-in list is used and says so.
resetPythonStdlibMemo();
info = getPythonStdlibInfo('/repo', () => null);
assert.strictEqual(info.source, 'fallback');
assert.strictEqual(info.version, null);
assert.strictEqual(info.names, PYTHON_STDLIB_FALLBACK);

resetPythonStdlibMemo();
info = getPythonStdlibInfo('/repo', () => { throw new Error('Store stub'); });
assert.strictEqual(info.source, 'fallback', 'an unreadable interpreter degrades the same way');

// The warning follows the source: present on fallback, absent otherwise, never stale.
function warningsFor(probe) {
  resetPythonStdlibMemo();
  getPythonStdlibInfo('/repo', probe);
  const graph = createMockDepGraph({ root: '/repo', schema: {} });
  return graph.analyzer.buildWarnings().filter((w) => w.type === 'python-stdlib-fallback');
}
const onFallback = warningsFor(() => null);
assert.strictEqual(onFallback.length, 1);
assert(/3\.\d+|interpreter/i.test(onFallback[0].message) && /built-in/i.test(onFallback[0].message), onFallback[0].message);
assert.deepStrictEqual(warningsFor(() => ({ names: new Set(['os']), version: '3.11.0' })), []);
resetPythonStdlibMemo();

// The language matrix in the overview carries the source and version.
const { buildLanguageSupportMatrix } = require('../src/tools/overview-assembler');
function matrixFor(probe) {
  resetPythonStdlibMemo();
  getPythonStdlibInfo('/repo', probe);
  const graph = createMockDepGraph({ root: '/repo', schema: { '/repo/app.py': { imports: [], exports: [] } } });
  return buildLanguageSupportMatrix(graph);
}
assert.deepStrictEqual(matrixFor(() => ({ names: new Set(['os']), version: '3.12.3' })).python.stdlib, { source: 'interpreter', version: '3.12.3' });
assert.deepStrictEqual(matrixFor(() => null).python.stdlib, { source: 'fallback', version: null });
resetPythonStdlibMemo();
assert.strictEqual(buildLanguageSupportMatrix(createMockDepGraph({ root: '/repo', schema: { '/repo/app.py': { imports: [], exports: [] } } })).python.stdlib, undefined, 'no field before Python was resolved');
