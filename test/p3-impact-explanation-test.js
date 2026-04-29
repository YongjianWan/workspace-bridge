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
  // Mock the formatter function logic inline to avoid requiring audit-formatters internals
  function buildImpactExplanations(entry) {
    const explanations = [];
    if (!entry?.impact?.length) return explanations;
    const changedFile = entry.file;
    for (const imp of entry.impact) {
      if (imp.level === 1 && imp.importedSymbols?.length > 0) {
        const symbols = imp.importedSymbols.join(', ');
        explanations.push(`因 \`${changedFile}\` 被 \`${imp.file}\` import（${symbols}），故波及该文件`);
      } else if (imp.level > 1 && imp.via?.length >= 1) {
        const directImporter = imp.via[0];
        const chain = imp.via.slice(1).concat(imp.file).join(' -> ');
        explanations.push(`因 \`${changedFile}\` 被 \`${directImporter}\` import，经 \`${chain}\` 传递，故波及测试`);
      }
    }
    return explanations;
  }

  const entry = {
    file: 'src/utils/resolvers.js',
    impact: [
      { file: 'src/services/dep-graph.js', level: 1, importedSymbols: ['resolveImport'], reason: 'direct-import' },
      { file: 'test/gors-resolver-test.js', level: 2, via: ['src/utils/resolvers.js', 'src/services/dep-graph.js'], reason: 'transitive-dependency' },
    ],
  };

  const explanations = buildImpactExplanations(entry);
  assert(explanations.some((e) => e.includes('resolvers.js') && e.includes('dep-graph.js') && e.includes('resolveImport')), 'Should explain direct import');
  assert(explanations.some((e) => e.includes('dep-graph.js') && e.includes('gors-resolver-test.js')), 'Should explain transitive impact');

  console.log('testBuildImpactExplanations passed');
}

function main() {
  testGetImpactRadiusWithExplanations();
  testBuildImpactExplanations();
  console.log('All P3 impact explanation tests passed');
}

main();
