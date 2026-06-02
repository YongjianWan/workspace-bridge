// @contract — GraphAnalyzer._getCircularDependencies must deduplicate duplicate imports
const assert = require('assert');
const { GraphAnalyzer } = require('../src/services/dep-graph/analyzer');

function testDuplicateImportsAreDeduped() {
  // Simulate a file that has two separate import records resolving to the same target
  // (e.g. two `require('./orchestrator')` statements in dep-graph.js)
  const mockDg = {
    normalizeFilePath: (p) => p,
    graph: new Map([
      ['/repo/a.js', {
        imports: ['/repo/b.js', '/repo/b.js'],
        importRecords: [
          { resolved: '/repo/b.js', isLazy: false },
          { resolved: '/repo/b.js', isLazy: false },
        ],
      }],
    ]),
    hasFile: () => true,
    bus: { on: () => {} },
  };

  const analyzer = new GraphAnalyzer(mockDg);
  const deps = analyzer._getCircularDependencies('/repo/a.js');
  assert.deepStrictEqual(deps, ['/repo/b.js'], 'duplicate imports must be deduplicated');
}

function testUniqueImportsPreserved() {
  const mockDg = {
    normalizeFilePath: (p) => p,
    graph: new Map([
      ['/repo/a.js', {
        imports: ['/repo/b.js', '/repo/c.js'],
        importRecords: [
          { resolved: '/repo/b.js', isLazy: false },
          { resolved: '/repo/c.js', isLazy: false },
        ],
      }],
    ]),
    hasFile: () => true,
    bus: { on: () => {} },
  };

  const analyzer = new GraphAnalyzer(mockDg);
  const deps = analyzer._getCircularDependencies('/repo/a.js');
  assert.strictEqual(deps.length, 2);
  assert(deps.includes('/repo/b.js'));
  assert(deps.includes('/repo/c.js'));
}

async function main() {
  testDuplicateImportsAreDeduped();
  testUniqueImportsPreserved();
}

main();
