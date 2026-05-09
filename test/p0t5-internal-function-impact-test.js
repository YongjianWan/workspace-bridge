#!/usr/bin/env node
const assert = require('assert');
const { getChangedFunctionImpact, getFunctionLevelAffectedTests } = require('../src/services/dep-graph/function-impact');

function testInternalFunctionChangeMapsToExportingCaller() {
  const sourceFile = '/repo/src/resolvers.js';

  const depGraph = {
    normalizeFilePath(file) { return file; },
    getFileInfo(file) {
      if (file !== sourceFile) return null;
      return {
        parseMode: 'ast',
        exportRecords: [
          {
            name: 'resolveImport',
            kind: 'function',
            lineStart: 40,
            lineEnd: 50,
            fingerprint: { callCallees: ['resolveGoImport'] },
          },
        ],
        functionRecords: [
          {
            name: 'readGoMod',
            kind: 'function',
            lineStart: 10,
            lineEnd: 15,
            fingerprint: { callCallees: [] },
          },
          {
            name: 'resolveGoImport',
            kind: 'function',
            lineStart: 20,
            lineEnd: 30,
            fingerprint: { callCallees: ['readGoMod'] },
          },
          {
            name: 'resolveImport',
            kind: 'function',
            lineStart: 40,
            lineEnd: 50,
            fingerprint: { callCallees: ['resolveGoImport'] },
          },
        ],
      };
    },
  };

  // 改动落在 readGoMod 的第 12 行
  const result = getChangedFunctionImpact(depGraph, sourceFile, [{ startLine: 12, endLine: 12 }]);

  assert.strictEqual(result.mode, 'internal-function-call-chain', `Expected internal-function-call-chain, got ${result.mode}`);
  assert.deepStrictEqual(result.changedFunctions, ['resolveImport']);
  console.log('testInternalFunctionChangeMapsToExportingCaller: ok');
}

function testDirectInternalCallerMapsToExport() {
  const sourceFile = '/repo/src/util.js';

  const depGraph = {
    normalizeFilePath(file) { return file; },
    getFileInfo(file) {
      if (file !== sourceFile) return null;
      return {
        parseMode: 'ast',
        exportRecords: [
          {
            name: 'publicFn',
            kind: 'function',
            lineStart: 1,
            lineEnd: 5,
            fingerprint: { callCallees: ['helperA'] },
          },
        ],
        functionRecords: [
          {
            name: 'publicFn',
            kind: 'function',
            lineStart: 1,
            lineEnd: 5,
            fingerprint: { callCallees: ['helperA'] },
          },
          {
            name: 'helperA',
            kind: 'function',
            lineStart: 7,
            lineEnd: 10,
            fingerprint: { callCallees: [] },
          },
        ],
      };
    },
  };

  const result = getChangedFunctionImpact(depGraph, sourceFile, [{ startLine: 8, endLine: 8 }]);

  assert.strictEqual(result.mode, 'internal-function-call-chain');
  assert.deepStrictEqual(result.changedFunctions, ['publicFn']);
  console.log('testDirectInternalCallerMapsToExport: ok');
}

function testFunctionLevelAffectedTestsUsesInternalChain() {
  const sourceFile = '/repo/src/util.js';

  const depGraph = {
    normalizeFilePath(file) { return file; },
    isTestLikeFile(file) { return file.includes('/test/'); },
    findAffectedTests() { return []; },
    getFileInfo(file) {
      if (file !== sourceFile) return null;
      return {
        parseMode: 'ast',
        exportRecords: [
          { name: 'publicFn', kind: 'function', lineStart: 1, lineEnd: 5 },
        ],
        functionRecords: [
          { name: 'publicFn', kind: 'function', lineStart: 1, lineEnd: 5, fingerprint: { callCallees: ['helperA'] } },
          { name: 'helperA', kind: 'function', lineStart: 7, lineEnd: 10, fingerprint: { callCallees: [] } },
        ],
      };
    },
  };

  const symbolImpact = {
    functionToDependents: [
      { function: 'publicFn', dependents: ['/repo/test/util.test.js'], dependentsCount: 1 },
    ],
  };

  const impact = getChangedFunctionImpact(depGraph, sourceFile, [{ startLine: 8, endLine: 8 }], { symbolImpact });
  assert.strictEqual(impact.mode, 'internal-function-call-chain');
  assert.deepStrictEqual(impact.changedFunctions, ['publicFn']);

  const affected = getFunctionLevelAffectedTests(depGraph, sourceFile, impact.changedFunctions, { symbolImpact, maxDepth: 4 });
  assert.strictEqual(affected.affectedTestsCount, 1);
  assert.strictEqual(affected.functions[0].function, 'publicFn');
  console.log('testFunctionLevelAffectedTestsUsesInternalChain: ok');
}

function testNoExportedFunctionChangeStillWorks() {
  const sourceFile = '/repo/src/util.js';

  const depGraph = {
    normalizeFilePath(file) { return file; },
    getFileInfo(file) {
      if (file !== sourceFile) return null;
      return {
        parseMode: 'ast',
        exportRecords: [
          { name: 'publicFn', kind: 'function', lineStart: 1, lineEnd: 5 },
        ],
        functionRecords: [
          { name: 'publicFn', lineStart: 1, lineEnd: 5, fingerprint: { callCallees: [] } },
          { name: 'orphanHelper', lineStart: 7, lineEnd: 10, fingerprint: { callCallees: [] } },
        ],
      };
    },
  };

  // orphanHelper 没有任何导出调用者
  const result = getChangedFunctionImpact(depGraph, sourceFile, [{ startLine: 8, endLine: 8 }]);

  assert.strictEqual(result.mode, 'no-exported-function-change');
  assert.deepStrictEqual(result.changedFunctions, []);
  console.log('testNoExportedFunctionChangeStillWorks: ok');
}

testInternalFunctionChangeMapsToExportingCaller();
testDirectInternalCallerMapsToExport();
testFunctionLevelAffectedTestsUsesInternalChain();
testNoExportedFunctionChangeStillWorks();
console.log('p0t5-internal-function-impact-test: ok');
