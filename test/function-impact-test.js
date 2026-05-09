#!/usr/bin/env node

const assert = require('assert');
const { getFunctionLevelAffectedTests } = require('../src/services/dep-graph/function-impact');

function main() {
  let bfsCalls = 0;
  const optionsSeen = [];
  const depGraph = {
    normalizeFilePath(file) {
      return file;
    },
    isTestLikeFile(file) {
      return file.includes('/test/');
    },
    findAffectedTests(file, maxDepth, options) {
      bfsCalls += 1;
      optionsSeen.push(options);
      return [{ file: '/repo/test/shared.test.js', distance: 1, via: [file] }];
    },
  };

  const symbolImpact = {
    functionToDependents: [
      { function: 'alpha', dependents: ['/repo/src/shared.js'], dependentsCount: 1 },
      { function: 'beta', dependents: ['/repo/src/shared.js'], dependentsCount: 1 },
    ],
  };

  const result = getFunctionLevelAffectedTests(
    depGraph,
    '/repo/src/util.js',
    ['alpha', 'beta'],
    { symbolImpact, maxDepth: 4 }
  );

  assert.strictEqual(bfsCalls, 1, 'shared dependent BFS should be computed once');
  assert.strictEqual(optionsSeen.length, 1, 'one BFS invocation expected');
  assert.strictEqual(optionsSeen[0]?.includeHeuristic, false, 'function-level BFS should disable heuristic mapping');
  assert.strictEqual(result.functions.length, 2, 'two functions should be reported');
  assert.strictEqual(result.affectedTestsCount, 1, 'unique affected tests should be de-duplicated');

  console.log('function-impact-test: ok');
}

main();

