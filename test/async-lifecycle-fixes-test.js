#!/usr/bin/env node
// @semantic
// @slow

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ServiceContainer, STATES } = require('../src/services/container');
const { EventBus } = require('../src/utils/event-bus');
const { registerGraphBuiltHandler } = require('../src/services/dep-graph/persistence');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * ServiceContainer must serialize pending:processed batches so that a batch
 * emitted while GraphBuilder.updateFiles is still running is not dropped.
 */
async function testPendingProcessedSerialization() {
  const container = new ServiceContainer({ quiet: true });
  const bus = new EventBus();
  container.fileIndex = { bus, getStats: () => ({}) };
  container.diagnostics = null;

  const processed = [];
  const dropped = [];
  let releaseCurrent = null;
  let busy = false;

  container._depGraph = {
    state: 'READY',
    _updating: false,
    async updateFiles(files) {
      if (busy) {
        dropped.push([...files]);
        return;
      }
      busy = true;
      this._updating = true;
      await new Promise((resolve) => {
        releaseCurrent = resolve;
      });
      processed.push([...files]);
      busy = false;
      this._updating = false;
      releaseCurrent = null;
    },
  };

  let snapshotCalls = 0;
  container._assembleSnapshot = () => {
    snapshotCalls++;
  };

  container._registerCallbacks();

  // Emit synchronously so the second event arrives while updateFiles is still
  // held (simulates overlapping watcher-driven processPending calls).
  bus.emit('pending:processed', ['a.js']);
  bus.emit('pending:processed', ['b.js']);

  // Give the container queue a chance to start the first update.
  await wait(20);
  assert.strictEqual(busy, true, 'first update should be in flight');
  assert.strictEqual(dropped.length, 0, 'no batch should be dropped while serializing');

  releaseCurrent();
  await wait(20);
  releaseCurrent();
  await wait(20);

  assert.strictEqual(processed.length, 2, 'both batches should be processed sequentially');
  assert.deepStrictEqual(processed[0], ['a.js']);
  assert.deepStrictEqual(processed[1], ['b.js']);
  assert.strictEqual(dropped.length, 0, 'no batch should be dropped');
  assert.strictEqual(snapshotCalls, 2, 'snapshot should be re-assembled after each batch');
}

/**
 * ServiceContainer.initialize() must assign _readyPromise before transitioning
 * to INITIALIZING so concurrent waiters cannot observe INITIALIZING with a null
 * promise.
 */
async function testReadyPromiseAssignedBeforeTransition() {
  const container = new ServiceContainer({ quiet: true });
  let nullDuringInit = false;
  const originalTransition = container._transition.bind(container);
  container._transition = (toState) => {
    if (toState === STATES.INITIALIZING && container._readyPromise === null) {
      nullDuringInit = true;
    }
    return originalTransition(toState);
  };
  container._runPipeline = async () => {};

  const ok = await container.initialize('/tmp/ready-promise-test', 30000, {});
  assert.strictEqual(ok, true, 'initialize should succeed');
  assert.strictEqual(container.initialized, true, 'container should be ready');
  assert.strictEqual(nullDuringInit, false, '_readyPromise must be assigned before INITIALIZING');
}

/**
 * GraphBuilder.updateFiles() must keep the graph in UPDATING state while
 * graph:built listeners (persistence) run, and only transition to READY after
 * persistence completes.
 */
async function testFinishUpdatingAfterPersistence() {
  const tmpDir = makeTempDir('wb-lifecycle-persist-');
  fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"test"}');
  fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'src', 'a.js'), "import { b } from './b';\nexport const a = 1;");
  fs.writeFileSync(path.join(tmpDir, 'src', 'b.js'), "export const b = 2;");

  const container = new ServiceContainer({ quiet: true });
  await container.initialize(tmpDir, 60000, { watch: false });

  const depGraph = container._depGraph;
  assert.strictEqual(depGraph.state, 'READY');

  const statesDuringBuilt = [];
  depGraph.bus.on('graph:built', () => {
    statesDuringBuilt.push(depGraph.state);
  });

  // Modify a.js so updateFiles has real work to do.
  fs.writeFileSync(
    path.join(tmpDir, 'src', 'a.js'),
    "import { b } from './b';\nimport { c } from './c';\nexport const a = 1;"
  );
  fs.writeFileSync(path.join(tmpDir, 'src', 'c.js'), "export const c = 3;");

  await depGraph.updateFiles([path.join(tmpDir, 'src', 'a.js'), path.join(tmpDir, 'src', 'c.js')]);

  assert.strictEqual(statesDuringBuilt.length, 1, 'graph:built should fire once');
  assert.strictEqual(
    statesDuringBuilt[0],
    'UPDATING',
    'graph:built listeners should see UPDATING state because _finishUpdating runs after persistence'
  );
  assert.strictEqual(depGraph.state, 'READY', 'state should return to READY after update completes');

  await container.shutdown();
  cleanupTempDir(tmpDir);
}

/**
 * The graph:built persistence listener must wrap precomputeAggregates and
 * precomputeImpact in try/catch so that a failure in either does not prevent
 * savePrecomputed from running.
 */
async function testPersistencePrecomputeTryCatch() {
  const bus = new EventBus();
  const saved = [];

  const depGraph = {
    bus,
    graph: new Map(),
    analyzer: {
      precomputeAggregates() {
        throw new Error('aggregate precompute boom');
      },
      precomputeImpact() {
        throw new Error('impact precompute boom');
      },
      getAggregateCache() {
        return { stats: { files: 1 }, deadExports: [], unresolved: [], cycles: [] };
      },
      getAggregateVersion() {
        return 1;
      },
      _impactCache: new Map(),
      _impactVersion: 1,
      _pageRanks: null,
    },
    cache: {
      savePrecomputedAggregates(rows) {
        saved.push({ type: 'aggregates', count: rows.length });
      },
      savePrecomputedImpact() {
        saved.push({ type: 'impact' });
      },
      saveRoutes() {
        saved.push({ type: 'routes' });
      },
      saveMetrics() {
        saved.push({ type: 'metrics' });
      },
      saveTestMap() {
        saved.push({ type: 'testMap' });
      },
    },
  };

  registerGraphBuiltHandler(depGraph);
  await bus.emitAsync('graph:built');

  assert(saved.some((s) => s.type === 'aggregates'), 'savePrecomputed should still run despite precompute errors');
}

async function main() {
  await testPendingProcessedSerialization();
  await testReadyPromiseAssignedBeforeTransition();
  await testFinishUpdatingAfterPersistence();
  await testPersistencePrecomputeTryCatch();
  console.log('async-lifecycle-fixes-test.js: all passed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
