const assert = require('assert');
const path = require('path');
const { DependencyGraph } = require('../src/services/dep-graph');
const { normalizePathKey } = require('../src/utils/path');

function n(p) {
  return normalizePathKey(p);
}

function testGetImpactRadiusWithExplanations() {
  const depGraph = new DependencyGraph('/repo', { fileMetadata: new Map() });
  const resolversPath = n('/repo/src/utils/resolvers.js');
  const depGraphPath = n('/repo/src/services/dep-graph.js');
  const testPath = n('/repo/test/gors-resolver-test.js');

  depGraph.graph = new Map([
    [resolversPath, {
      imports: [],
      exports: ['resolveImport'],
      importRecords: [],
      parseMode: 'ast',
    }],
    [depGraphPath, {
      imports: [resolversPath],
      exports: ['DependencyGraph'],
      importRecords: [{
        source: '../utils/resolvers',
        resolved: resolversPath,
        imported: ['resolveImport'],
        usesAllExports: false,
      }],
      parseMode: 'ast',
    }],
    [testPath, {
      imports: [depGraphPath],
      exports: [],
      importRecords: [{
        source: '../../src/services/dep-graph',
        resolved: depGraphPath,
        imported: ['DependencyGraph'],
        usesAllExports: false,
      }],
      parseMode: 'ast',
    }],
  ]);
  depGraph.buildReverseGraph();

  const impact = depGraph.getImpactRadius(resolversPath);

  const level1 = impact.find((i) => i.file === depGraphPath);
  assert(level1, 'dep-graph.js should be in impact radius (level 1)');
  assert.strictEqual(level1.level, 1);
  assert.deepStrictEqual(level1.via, [resolversPath]);
  assert.deepStrictEqual(level1.importedSymbols, ['resolveImport']);
  assert.strictEqual(level1.reason, 'direct-import');

  const level2 = impact.find((i) => i.file === testPath);
  assert(level2, 'test file should be in impact radius (level 2)');
  assert.strictEqual(level2.level, 2);
  assert.deepStrictEqual(level2.via, [resolversPath, depGraphPath]);
  assert.strictEqual(level2.reason, 'transitive-dependency');

  console.log('testGetImpactRadiusWithExplanations passed');
}

function testBuildImpactExplanations() {
  const { buildImpactExplanations } = require('../src/cli/formatters');

  const entry = {
    file: 'src/utils/resolvers.js',
    impact: [
      { file: 'src/services/dep-graph.js', level: 1, importedSymbols: ['resolveImport'], reason: 'direct-import' },
      { file: 'test/gors-resolver-test.js', level: 2, via: ['src/utils/resolvers.js', 'src/services/dep-graph.js'], reason: 'transitive-dependency' },
    ],
  };

  const explanations = buildImpactExplanations(entry);
  assert(explanations.some((e) => e.includes('resolvers.js') && e.includes('dep-graph.js') && e.includes('resolveImport')), 'Should explain direct import');
  const transitive = explanations.find((e) => e.includes('gors-resolver-test.js'));
  assert(transitive, 'Should explain transitive impact');
  assert(!transitive.includes('被 `src/utils/resolvers.js` import'), 'directImporter should not be the changed file itself');
  assert(transitive.includes('被 `src/services/dep-graph.js` import'), 'directImporter should be the immediate upstream file');

  console.log('testBuildImpactExplanations passed');
}

function main() {
  testGetImpactRadiusWithExplanations();
  testBuildImpactExplanations();
  console.log('All P3 impact explanation tests passed');
}

main();
