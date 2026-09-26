#!/usr/bin/env node
// @semantic @slow — four ServiceContainer lifecycles (cold / delta-warm / cold / pure-warm)
// P0-8: incremental (warm) builds must give the same graph as a cold build for
// identical code. Root cause of the divergence: `package` was never persisted
// in parse_results (graph-db.js column list), so every warm path that lands in
// build() — loadGraph rejected because a new file shifted fileMetadataCount —
// restored package-less nodes, _buildPackageIndex() came up empty/partial and
// expandJavaPackageImports() silently skipped the cached files. Warm lost the
// same-package edges cold produced.
//
// Contract under test: the observable graph (dependents of a referenced and an
// unreferenced package-mate) is identical across
//   1. cold build,
//   2. delta-warm start (loadGraph rejected → build() over cache hits),
//   3. pure-warm start (loadGraph success → postProcess phase replay).
// The build counter guards the classic vacuity: a "warm" run that silently
// fell back to cold would compare cold vs cold.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ServiceContainer } = require('../src/services/container');
const { DependencyGraph } = require('../src/services/dep-graph');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

let buildCalls = 0;
const originalBuild = DependencyGraph.prototype.build;
DependencyGraph.prototype.build = function countedBuild(...args) {
  buildCalls++;
  return originalBuild.apply(this, args);
};

function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  return full;
}

function observe(container, root) {
  const dg = container._depGraph;
  const out = {};
  for (const rel of [
    'src/a/svc/Helper.java',
    'src/a/svc/Service.java',
    'src/a/svc/Unrelated.java',
    'src/a/svc/Extra.java',
  ]) {
    const key = dg.normalizeFilePath(path.join(root, rel));
    // Graph keys are lowercased on Windows (normalizePathKey), original case
    // on POSIX — compare case-insensitively for platform stability.
    out[path.basename(rel)] = (dg.getDependents(key) || [])
      .map((f) => path.basename(f).toLocaleLowerCase('en-US'))
      .sort();
  }
  return out;
}

async function start(root) {
  const container = new ServiceContainer({ quiet: true, cacheDir: path.join(root, '.cache') });
  await container.initialize(root, 120000, { watch: false });
  return container;
}

async function main() {
  const root = makeTempDir('wb-p08-java-parity-');
  try {
    write(root, 'src/a/svc/Service.java',
      'package a.svc;\npublic class Service { public int run() { return Helper.h(); } }\n');
    write(root, 'src/a/svc/Helper.java',
      'package a.svc;\npublic class Helper { public static int h() { return 1; } }\n');
    write(root, 'src/a/svc/Unrelated.java',
      'package a.svc;\npublic class Unrelated { public int z() { return 0; } }\n');

    // 1. cold
    const cold1 = await start(root);
    assert.strictEqual(buildCalls, 1, 'first start must be a real cold build');
    const viewA = observe(cold1, root);
    await cold1.shutdown();

    // 2. delta-warm: new file ⇒ loadGraph rejected on fileMetadataCount ⇒
    // build() over cached parse results — the path where package must survive
    // the SQLite round-trip or the expansion silently skips cached files.
    write(root, 'src/a/svc/Extra.java', 'package a.svc;\npublic class Extra {}\n');
    const deltaWarm = await start(root);
    assert.strictEqual(
      buildCalls,
      2,
      'second start must take the loadGraph-rejected → build() path (if loadGraph succeeded the fixture is not exercising P0-8)'
    );
    const viewB = observe(deltaWarm, root);
    await deltaWarm.shutdown();

    // 3. cold with the same 4 files (fresh cache) — the reference answer
    fs.rmSync(path.join(root, '.cache'), { recursive: true, force: true });
    const cold2 = await start(root);
    assert.strictEqual(buildCalls, 3, 'third start must be a fresh cold build');
    const viewC = observe(cold2, root);
    await cold2.shutdown();

    // 4. pure-warm: no changes since the last save ⇒ loadGraph success ⇒
    // postProcess phase replay over restored edges.
    const pureWarm = await start(root);
    assert.strictEqual(
      buildCalls,
      3,
      'fourth start must take the loadGraph path — a fallback to build() would make this comparison vacuous'
    );
    const viewD = observe(pureWarm, root);
    await pureWarm.shutdown();

    // The referenced pair is the load-bearing assertion: without persisted
    // `package` the delta-warm build loses Service→Helper entirely.
    assert.deepStrictEqual(
      viewC['Helper.java'],
      ['service.java'],
      'fixture sanity: only Service references Helper'
    );
    assert.deepStrictEqual(viewB, viewC, 'delta-warm graph must equal the cold graph');
    assert.deepStrictEqual(viewD, viewC, 'pure-warm graph must equal the cold graph');
    assert.deepStrictEqual(viewA['Unrelated.java'], [], 'nobody references Unrelated (P0-7 gate holds on cold)');
    assert.deepStrictEqual(viewB['Extra.java'], [], 'nobody references Extra on either path');
  } finally {
    cleanupTempDir(root);
  }
  console.log('p0-8-incremental-java-parity-test: all passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
