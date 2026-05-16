const assert = require('assert');
const path = require('path');
const { DependencyGraph } = require('../src/services/dep-graph');
const { normalizePathKey } = require('../src/utils/path');
const { buildMockDepGraph } = require('./test-helpers');

function n(p) {
  return normalizePathKey(p);
}

function testGetImpactRadiusWithExplanations() {
  const depGraph = new DependencyGraph('/repo', { fileMetadata: new Map() });
  const resolversPath = n('/repo/src/utils/resolvers.js');
  const depGraphPath = n('/repo/src/services/dep-graph.js');
  const testPath = n('/repo/test/gors-resolver-test.js');

  depGraph.graph = buildMockDepGraph({
    [resolversPath]: {
      imports: [],
      exports: ['resolveImport'],
      importRecords: [],
      parseMode: 'ast',
    },
    [depGraphPath]: {
      imports: [resolversPath],
      exports: ['DependencyGraph'],
      importRecords: [{
        source: '../utils/resolvers',
        resolved: resolversPath,
        imported: ['resolveImport'],
        usesAllExports: false,
      }],
      parseMode: 'ast',
    },
    [testPath]: {
      imports: [depGraphPath],
      exports: [],
      importRecords: [{
        source: '../../src/services/dep-graph',
        resolved: depGraphPath,
        imported: ['DependencyGraph'],
        usesAllExports: false,
      }],
      parseMode: 'ast',
    },
  });
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

}

function testGetImpactRadiusTruncatesAtEntryFiles() {
  const depGraph = new DependencyGraph('/repo', { fileMetadata: new Map() });
  const utilPath = n('/repo/src/utils/path.js');
  const cliPath = n('/repo/cli.js');
  const indexPath = n('/repo/src/index.js');

  depGraph.graph = buildMockDepGraph({
    [utilPath]: { imports: [], exports: [], importRecords: [], parseMode: 'ast' },
    [cliPath]: {
      imports: [utilPath],
      exports: [],
      importRecords: [{ source: './utils/path', resolved: utilPath, imported: [], usesAllExports: false }],
      parseMode: 'ast',
    },
    [indexPath]: {
      imports: [cliPath],
      exports: [],
      importRecords: [{ source: '../cli', resolved: cliPath, imported: [], usesAllExports: false }],
      parseMode: 'ast',
    },
  });
  depGraph.buildReverseGraph();

  const impact = depGraph.getImpactRadius(utilPath, 5);

  const cliImpact = impact.find((i) => i.file === cliPath);
  assert(cliImpact, 'cli.js should be in impact radius (level 1, entry file)');
  assert.strictEqual(cliImpact.level, 1);

  const indexImpact = impact.find((i) => i.file === indexPath);
  assert(!indexImpact, 'index.js should NOT be in impact radius because cli.js is an entry file');

}

function testGetImpactRadiusDoesNotTruncateStartNode() {
  const depGraph = new DependencyGraph('/repo', { fileMetadata: new Map() });
  const cliPath = n('/repo/cli.js');
  const indexPath = n('/repo/src/index.js');

  depGraph.graph = buildMockDepGraph({
    [cliPath]: { imports: [], exports: [], importRecords: [], parseMode: 'ast' },
    [indexPath]: {
      imports: [cliPath],
      exports: [],
      importRecords: [{ source: '../cli', resolved: cliPath, imported: [], usesAllExports: false }],
      parseMode: 'ast',
    },
  });
  depGraph.buildReverseGraph();

  const impact = depGraph.getImpactRadius(cliPath, 5);

  const indexImpact = impact.find((i) => i.file === indexPath);
  assert(indexImpact, 'index.js should be in impact radius even though cli.js is the start node and is an entry file');
  assert.strictEqual(indexImpact.level, 1);

}

function main() {
  testGetImpactRadiusWithExplanations();
  testBuildImpactExplanations();
  testGetImpactRadiusTruncatesAtEntryFiles();
  testGetImpactRadiusDoesNotTruncateStartNode();
}

main();
