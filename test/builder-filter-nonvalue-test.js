#!/usr/bin/env node
// @semantic
// Structural edges include compile-time type dependencies; the remaining
// filter only applies to heuristic Java utility edges.

const assert = require('assert');
const path = require('path');
const { GraphBuilder } = require('../src/services/dep-graph/builder');

function makeMockDepGraph(entries) {
  const graph = new Map();
  for (const [key, info] of entries) {
    graph.set(key, info);
  }
  return {
    graph,
    normalizeFilePath: (p) => p,
  };
}

function testTypeOnlyImportPreserved() {
  const dg = makeMockDepGraph([
    ['app.ts', {
      imports: ['types.ts'],
      importRecords: [{ resolved: 'types.ts', importKind: 'type', source: './types' }],
      exportRecords: [],
    }],
    ['types.ts', {
      imports: [],
      importRecords: [],
      exportRecords: [{ name: 'User', kind: 'interface' }],
    }],
  ]);

  const builder = new GraphBuilder(dg);
  builder._filterNonValueImports();

  const appInfo = dg.graph.get('app.ts');
  assert.strictEqual(
    appInfo.imports.includes('types.ts'),
    true,
    'type imports remain structural dependencies'
  );
}

function testIsTypeOnlyPreserved() {
  const dg = makeMockDepGraph([
    ['app.ts', {
      imports: ['types.ts'],
      importRecords: [{ resolved: 'types.ts', isTypeOnly: true, source: './types' }],
      exportRecords: [],
    }],
    ['types.ts', {
      imports: [],
      importRecords: [],
      exportRecords: [{ name: 'User', kind: 'type' }],
    }],
  ]);

  const builder = new GraphBuilder(dg);
  builder._filterNonValueImports();

  const appInfo = dg.graph.get('app.ts');
  assert.strictEqual(
    appInfo.imports.includes('types.ts'),
    true,
    'isTypeOnly imports remain structural dependencies'
  );
}

function testAllExportsAreTypesPreserved() {
  const dg = makeMockDepGraph([
    ['app.ts', {
      imports: ['iface.ts'],
      importRecords: [{ resolved: 'iface.ts', source: './iface', imported: ['Config'] }],
      exportRecords: [],
    }],
    ['iface.ts', {
      imports: [],
      importRecords: [],
      exportRecords: [{ name: 'Config', kind: 'interface' }],
    }],
  ]);

  const builder = new GraphBuilder(dg);
  builder._filterNonValueImports();

  const appInfo = dg.graph.get('app.ts');
  assert.strictEqual(
    appInfo.imports.includes('iface.ts'),
    true,
    'interface-only targets remain compile-time dependencies'
  );
}

function testAllImportedSymbolsAreTypesPreserved() {
  const dg = makeMockDepGraph([
    ['app.ts', {
      imports: ['iface.ts'],
      importRecords: [{ resolved: 'iface.ts', source: './iface', imported: ['Config', 'Opts'] }],
      exportRecords: [],
    }],
    ['iface.ts', {
      imports: [],
      importRecords: [],
      exportRecords: [
        { name: 'Config', kind: 'interface' },
        { name: 'Opts', kind: 'type' },
        { name: 'VERSION', kind: 'variable' },
      ],
    }],
  ]);

  const builder = new GraphBuilder(dg);
  builder._filterNonValueImports();

  const appInfo = dg.graph.get('app.ts');
  assert.strictEqual(
    appInfo.imports.includes('iface.ts'),
    true,
    'type-only symbol references remain compile-time dependencies'
  );
}

function testRule3MixedExportNotFiltered() {
  const dg = makeMockDepGraph([
    ['app.ts', {
      imports: ['lib.ts'],
      importRecords: [{ resolved: 'lib.ts', source: './lib', imported: ['foo'] }],
      exportRecords: [],
    }],
    ['lib.ts', {
      imports: [],
      importRecords: [],
      exportRecords: [
        { name: 'foo', kind: 'variable' },
        { name: 'Config', kind: 'interface' },
      ],
    }],
  ]);

  const builder = new GraphBuilder(dg);
  builder._filterNonValueImports();

  const appInfo = dg.graph.get('app.ts');
  assert.strictEqual(
    appInfo.imports.includes('lib.ts'),
    true,
    'Rule 3: target with mixed exports (value + type) should NOT be pruned when importing value symbol'
  );
}

function testRule5JavaUtilityMutualPruned() {
  const stringUtils = '/project/src/utils/StringUtils.java';
  const dateUtils = '/project/src/utils/DateUtils.java';

  const dg = makeMockDepGraph([
    [stringUtils, {
      imports: [dateUtils],
      importRecords: [{ resolved: dateUtils, source: 'com.app.utils.DateUtils' }],
      exportRecords: [{ name: 'StringUtils', kind: 'class' }],
    }],
    [dateUtils, {
      imports: [stringUtils],
      importRecords: [{ resolved: stringUtils, source: 'com.app.utils.StringUtils' }],
      exportRecords: [{ name: 'DateUtils', kind: 'class' }],
    }],
  ]);

  const builder = new GraphBuilder(dg);
  builder._filterNonValueImports();

  assert.strictEqual(
    dg.graph.get(stringUtils).imports.includes(dateUtils),
    false,
    'Rule 5: Java utility↔utility edge should be pruned'
  );
  assert.strictEqual(
    dg.graph.get(dateUtils).imports.includes(stringUtils),
    false,
    'Rule 5: reverse Java utility↔utility edge should also be pruned'
  );
}

function testRule6JavaUtilityToEntityPruned() {
  const helper = '/project/src/utils/Helper.java';
  const user = '/project/src/model/User.java';

  const dg = makeMockDepGraph([
    [helper, {
      imports: [user],
      importRecords: [{ resolved: user, source: 'com.app.model.User' }],
      exportRecords: [{ name: 'Helper', kind: 'class' }],
    }],
    [user, {
      imports: [],
      importRecords: [],
      exportRecords: [{ name: 'User', kind: 'class' }],
    }],
  ]);

  const builder = new GraphBuilder(dg);
  builder._filterNonValueImports();

  assert.strictEqual(
    dg.graph.get(helper).imports.includes(user),
    false,
    'Rule 6: Java utility→entity edge should be pruned'
  );
}

function testValueImportPreserved() {
  const app = '/project/src/app.js';
  const lib = '/project/src/lib.js';

  const dg = makeMockDepGraph([
    [app, {
      imports: [lib],
      importRecords: [{ resolved: lib, source: './lib', imported: ['foo'] }],
      exportRecords: [{ name: 'app', kind: 'variable' }],
    }],
    [lib, {
      imports: [],
      importRecords: [],
      exportRecords: [{ name: 'foo', kind: 'variable' }],
    }],
  ]);

  const builder = new GraphBuilder(dg);
  builder._filterNonValueImports();

  assert.strictEqual(
    dg.graph.get(app).imports.includes(lib),
    true,
    'Normal value import should be preserved'
  );
}

function testNoImportRecordUsesResolvedMatch() {
  // When no importRecord matches, the filter falls through to path-based rules.
  // For non-Java files with no importRecord, the edge should be preserved.
  const app = path.normalize('/project/src/app.js');
  const lib = path.normalize('/project/src/lib.js');

  const dg = makeMockDepGraph([
    [app, {
      imports: [lib],
      importRecords: [{ resolved: 'other.js', source: './other' }], // does not match lib
      exportRecords: [],
    }],
    [lib, {
      imports: [],
      importRecords: [],
      exportRecords: [{ name: 'foo', kind: 'variable' }],
    }],
  ]);

  const builder = new GraphBuilder(dg);
  builder._filterNonValueImports();

  assert.strictEqual(
    dg.graph.get(app).imports.includes(lib),
    true,
    'Edge without matching importRecord should be preserved'
  );
}

function main() {
  testTypeOnlyImportPreserved();
  testIsTypeOnlyPreserved();
  testAllExportsAreTypesPreserved();
  testAllImportedSymbolsAreTypesPreserved();
  testRule3MixedExportNotFiltered();
  testRule5JavaUtilityMutualPruned();
  testRule6JavaUtilityToEntityPruned();
  testValueImportPreserved();
  testNoImportRecordUsesResolvedMatch();
  console.log('builder-filter-nonvalue-test.js: all passed');
}

main();
