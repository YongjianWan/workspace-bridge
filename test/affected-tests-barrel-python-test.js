#!/usr/bin/env node
// @semantic

const assert = require('assert');
const { createMockDepGraph } = require('./test-helpers');
const { normalizePathKey } = require('../src/utils/path');

const P = (value) => normalizePathKey(value);

function makeGraph() {
  return createMockDepGraph({
    root: P('/repo'),
    schema: {
      [P('/repo/src/core/util.ts')]: { imports: [], exports: ['helper'] },
      [P('/repo/src/core/index.ts')]: { imports: [P('/repo/src/core/util.ts')], exports: ['helper'] },
      [P('/repo/src/app.ts')]: { imports: [P('/repo/src/core/index.ts')], exports: ['run'] },
      [P('/repo/test/app.test.ts')]: { imports: [P('/repo/src/app.ts')], exports: ['testRun'] },

      [P('/repo/pkg/module.py')]: { imports: [], exports: ['run'] },
      [P('/repo/tests/test_module.py')]: { imports: [], exports: ['test_run'] },
      [P('/repo/tests/module_test.py')]: { imports: [], exports: ['test_run_alt'] },
      [P('/repo/tests/other_test.py')]: { imports: [], exports: ['test_other'] },
    }
  });
}

function main() {
  const depGraph = makeGraph();

  const barrelTests = depGraph.findAffectedTests(P('/repo/src/core/util.ts'), 5, { includeHeuristic: false });
  const barrelFiles = barrelTests.map((entry) => entry.file.replace(/\\/g, '/'));
  assert(barrelFiles.some((file) => file.endsWith('/repo/test/app.test.ts')), 'barrel re-export chain should map to downstream tests');
  assert(barrelTests.some((entry) => entry.source === 'graph'), 'barrel mapping should be graph-based');

  const pythonTests = depGraph.findAffectedTests(P('/repo/pkg/module.py'), 5, { includeHeuristic: true });
  const pythonFiles = pythonTests.map((entry) => entry.file.replace(/\\/g, '/'));
  assert(pythonFiles.some((file) => file.endsWith('/repo/tests/test_module.py')), 'python tests/test_module.py should be mapped');
  assert(pythonFiles.some((file) => file.endsWith('/repo/tests/module_test.py')), 'python tests/module_test.py should be mapped');
  assert(!pythonFiles.some((file) => file.endsWith('/repo/tests/other_test.py')), 'unrelated python tests should not be mapped');
  assert(
    pythonTests.filter((entry) => entry.file.replace(/\\/g, '/').includes('/repo/tests/')).every((entry) => ['heuristic', 'graph'].includes(entry.source)),
    'python mapping rows should include source metadata'
  );
}

main();
