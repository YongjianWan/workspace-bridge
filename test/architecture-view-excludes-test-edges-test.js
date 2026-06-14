// @semantic — architecture view (overview/skeleton/hotspots/stability) excludes test→source edges while impact view keeps them
const assert = require('assert');
const path = require('path');
const { normalizePathKey } = require('../src/utils/path');
const { createMockDepGraph } = require('./test-helpers');
const { identifyCoreModules, buildStability } = require('../src/tools/overview-assembler');

function makeProjectContext(root) {
  return {
    classifyFile(filePath) {
      const rel = path.relative(root, filePath).replace(/\\/g, '/');
      if (rel.startsWith('test/')) return { isMainline: true, fileRole: 'test', directoryRole: 'active' };
      if (rel === 'src/app.js') return { isMainline: true, fileRole: 'entry', directoryRole: 'active' };
      return { isMainline: true, fileRole: 'library', directoryRole: 'active' };
    },
  };
}

function buildFixture(root) {
  const lib = path.join(root, 'src', 'lib.js');
  const app = path.join(root, 'src', 'app.js');
  const testLib = path.join(root, 'test', 'lib.test.js');
  const dg = createMockDepGraph({
    root,
    schema: {
      [lib]: { imports: [], exports: ['helper'], exportRecords: [{ name: 'helper' }], parseMode: 'ast' },
      [app]: { imports: [lib], exports: [], importRecords: [{ source: './lib', resolved: lib, imported: ['helper'] }], parseMode: 'ast' },
      [testLib]: { imports: [lib], exports: [], importRecords: [{ source: '../src/lib', resolved: lib, imported: ['helper'] }], parseMode: 'ast' },
    },
    projectContext: makeProjectContext(root),
    entryFiles: new Set([app]),
  });
  return { dg, lib, app, testLib };
}

function testArchitectureOnlyDependents() {
  const root = path.resolve('/repo');
  const { dg, lib, app } = buildFixture(root);
  const allDependents = dg.getDependents(lib);
  assert.strictEqual(allDependents.length, 2, 'impact view should see both app and test dependents');

  const archDependents = dg.getDependents(lib, { architectureOnly: true });
  assert.strictEqual(archDependents.length, 1, 'architecture view should exclude test dependents');
  assert.strictEqual(normalizePathKey(archDependents[0]), normalizePathKey(app));
}

function testArchitectureOnlyDependencies() {
  const root = path.resolve('/repo');
  const lib = path.join(root, 'src', 'lib.js');
  const app = path.join(root, 'src', 'app.js');
  const testLib = path.join(root, 'test', 'lib.test.js');
  const helper = path.join(root, 'test', 'helper.js');
  const dg = createMockDepGraph({
    root,
    schema: {
      [lib]: { imports: [helper], exports: ['helper'], importRecords: [{ source: '../test/helper', resolved: helper }], parseMode: 'ast' },
      [app]: { imports: [lib], exports: [], importRecords: [{ source: './lib', resolved: lib }], parseMode: 'ast' },
      [testLib]: { imports: [lib], exports: [], importRecords: [{ source: '../src/lib', resolved: lib }], parseMode: 'ast' },
      [helper]: { imports: [], exports: ['fixture'], exportRecords: [{ name: 'fixture' }], parseMode: 'ast' },
    },
    projectContext: makeProjectContext(root),
    entryFiles: new Set([app]),
  });

  const allDeps = dg.getDependencies(lib);
  assert.strictEqual(allDeps.length, 1, 'impact view should see helper dependency');

  const archDeps = dg.getDependencies(lib, { architectureOnly: true });
  assert.strictEqual(archDeps.length, 0, 'architecture view should exclude source→test dependency');
}

function testIdentifyCoreModulesExcludesTestEdges() {
  const root = path.resolve('/repo');
  const lib = path.join(root, 'src', 'lib.js');
  const app = path.join(root, 'src', 'app.js');
  const a2 = path.join(root, 'src', 'a2.js');
  const a3 = path.join(root, 'src', 'a3.js');
  const testLib = path.join(root, 'test', 'lib.test.js');
  const dg = createMockDepGraph({
    root,
    schema: {
      [lib]: { imports: [], exports: ['helper'], exportRecords: [{ name: 'helper' }], parseMode: 'ast' },
      [app]: { imports: [lib], exports: [], importRecords: [{ source: './lib', resolved: lib }], parseMode: 'ast' },
      [a2]: { imports: [lib], exports: [], importRecords: [{ source: './lib', resolved: lib }], parseMode: 'ast' },
      [a3]: { imports: [lib], exports: [], importRecords: [{ source: './lib', resolved: lib }], parseMode: 'ast' },
      [testLib]: { imports: [lib], exports: [], importRecords: [{ source: '../src/lib', resolved: lib }], parseMode: 'ast' },
    },
    projectContext: makeProjectContext(root),
    entryFiles: new Set([app]),
  });
  const files = dg.getAllFilePaths();
  const core = identifyCoreModules(dg, files, dg.projectContext, root);
  const libCore = core.find((c) => c.file.endsWith('src/lib.js'));
  assert(libCore, 'lib.js should be identified as core module');
  assert.strictEqual(libCore.dependentsCount, 3, 'core module dependents should exclude test edges');
}

function testBuildStabilityExcludesTestEdgesButKeepsHasTests() {
  const root = path.resolve('/repo');
  const { dg, lib } = buildFixture(root);
  const stability = buildStability(root, dg, [lib], dg.projectContext);
  const libStability = stability.find((s) => s.file.endsWith('src/lib.js'));
  assert(libStability, 'lib.js should have stability entry');
  assert.strictEqual(libStability.coupling.inDegree, 1, 'stability in-degree should exclude test dependents');
  assert.strictEqual(libStability.hasTests, true, 'hasTests should still be true because test edge exists in impact view');
}

function testImpactRadiusStillIncludesTestFiles() {
  const root = path.resolve('/repo');
  const { dg, lib, testLib } = buildFixture(root);
  const impact = dg.getImpactRadius(lib);
  const impactedPaths = impact.map((r) => normalizePathKey(r.file));
  assert(impactedPaths.some((p) => p.includes('/test/')), 'impact radius should still include test dependents');
  assert(impactedPaths.includes(normalizePathKey(testLib)), 'impact radius should include the exact test file');
}

async function main() {
  testArchitectureOnlyDependents();
  testArchitectureOnlyDependencies();
  testIdentifyCoreModulesExcludesTestEdges();
  testBuildStabilityExcludesTestEdgesButKeepsHasTests();
  testImpactRadiusStillIncludesTestFiles();
  console.log('architecture-view-excludes-test-edges-test.js: all passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
