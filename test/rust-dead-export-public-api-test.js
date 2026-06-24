#!/usr/bin/env node
// @semantic
/**
 * Verify that Rust library public API modules (re-exported by src/lib.rs)
 * are downgraded in dead-export findings instead of being reported with
 * high confidence as dead code.
 */

const assert = require('assert');
const { createMockDepGraph } = require('./test-helpers');

function testPublicApiModuleDowngraded() {
  const depGraph = createMockDepGraph({
    root: '/repo',
    schema: {
      '/repo/src/lib.rs': {
        imports: [],
        exports: ['guard'],
        exportRecords: [
          { name: 'guard', kind: 'module' },
        ],
        importRecords: [],
        parseMode: 'ast',
      },
      '/repo/src/guard.rs': {
        imports: [],
        exports: ['GuardConfig', 'DEFAULT_PAGERANK_MIN'],
        exportRecords: [
          { name: 'GuardConfig', kind: 'struct' },
          { name: 'DEFAULT_PAGERANK_MIN', kind: 'const' },
        ],
        importRecords: [],
        parseMode: 'ast',
      },
      '/repo/src/internal.rs': {
        imports: [],
        exports: ['Helper'],
        exportRecords: [{ name: 'Helper', kind: 'function' }],
        importRecords: [],
        parseMode: 'ast',
      },
    },
  });

  const dead = depGraph.findDeadExports();

  const guardFinding = dead.find((d) => d.file === '/repo/src/guard.rs');
  const internalFinding = dead.find((d) => d.file === '/repo/src/internal.rs');

  assert(guardFinding, 'guard.rs should be in dead exports');
  assert(internalFinding, 'internal.rs should be in dead exports');

  assert.strictEqual(
    guardFinding.falsePositiveReason,
    'rust-public-api',
    'Public API module re-exported by lib.rs should be marked rust-public-api'
  );
  assert.strictEqual(
    guardFinding.confidence,
    'low',
    'Public API module finding should be downgraded to low confidence'
  );
  assert.strictEqual(
    guardFinding.confidenceSource,
    'rust-public-api',
    'Public API module confidenceSource should be rust-public-api'
  );

  assert(
    internalFinding.falsePositiveReason !== 'rust-public-api',
    'Non-public internal module should not be marked rust-public-api'
  );
  assert(
    internalFinding.confidenceSource !== 'rust-public-api',
    'Non-public internal module should not use rust-public-api confidenceSource'
  );
}

function testNestedModPublicApiDowngraded() {
  const depGraph = createMockDepGraph({
    root: '/repo',
    schema: {
      '/repo/src/lib.rs': {
        imports: [],
        exports: ['storage'],
        exportRecords: [{ name: 'storage', kind: 'module' }],
        importRecords: [],
        parseMode: 'ast',
      },
      '/repo/src/storage/mod.rs': {
        imports: [],
        exports: ['StorageError'],
        exportRecords: [{ name: 'StorageError', kind: 'type' }],
        importRecords: [],
        parseMode: 'ast',
      },
    },
  });

  const dead = depGraph.findDeadExports();
  const finding = dead.find((d) => d.file === '/repo/src/storage/mod.rs');

  assert(finding, 'storage/mod.rs should be in dead exports');
  assert.strictEqual(
    finding.falsePositiveReason,
    'rust-public-api',
    'Nested public API module (src/<name>/mod.rs) should be marked rust-public-api'
  );
}

function testBinaryCrateUnaffected() {
  const depGraph = createMockDepGraph({
    root: '/repo',
    schema: {
      '/repo/src/main.rs': {
        imports: [],
        exports: ['run'],
        exportRecords: [{ name: 'run', kind: 'function' }],
        importRecords: [],
        parseMode: 'ast',
      },
      '/repo/src/guard.rs': {
        imports: [],
        exports: ['GuardConfig'],
        exportRecords: [{ name: 'GuardConfig', kind: 'struct' }],
        importRecords: [],
        parseMode: 'ast',
      },
    },
  });

  const dead = depGraph.findDeadExports();
  const finding = dead.find((d) => d.file === '/repo/src/guard.rs');

  assert(finding, 'guard.rs should be in dead exports for binary crate');
  assert.notStrictEqual(
    finding.falsePositiveReason,
    'rust-public-api',
    'Binary crate without lib.rs should not mark modules as rust-public-api'
  );
}

function main() {
  testPublicApiModuleDowngraded();
  testNestedModPublicApiDowngraded();
  testBinaryCrateUnaffected();
  console.log('PASS: rust-dead-export-public-api-test');
}

main();
