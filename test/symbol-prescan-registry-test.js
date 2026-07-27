#!/usr/bin/env node
// @contract
// SymbolRegistry Stage 4 Step 1 prescan & disambiguation tests
const assert = require('assert');
const path = require('path');
const { SymbolRegistry } = require('../src/services/dep-graph/symbol-registry');
const { ServiceContainer } = require('../src/services/container');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

function testSymbolRegistryDisambiguationMath() {
  const registry = new SymbolRegistry();
  const fileA = '/repo/src/services/user.js';
  const fileB = '/repo/src/models/user.js';

  // fileA exports 'User' explicitly; fileB declares 'User' internally (isExported: false)
  registry.register(fileA, [{ name: 'User', kind: 'class', isExported: true }]);
  registry.register(fileB, [{ name: 'User', kind: 'class', isExported: false }]);

  // Look up from /repo/src/services/other.js (same dir as fileA)
  const matchA = registry.lookupBestMatch('User', '/repo/src/services/other.js');
  assert.strictEqual(matchA, fileA, 'explicit export in same dir must win highest score');

  // Look up from /repo/src/models/other.js — same dir as fileB, but fileB is not
  // exported and is therefore not a candidate at all, leaving fileA unopposed.
  const matchExplicit = registry.lookupBestMatch('User', '/repo/src/models/other.js');
  assert.strictEqual(matchExplicit, fileA, 'explicit export bonus must dominate non-exported local candidate');

  console.log('testSymbolRegistryDisambiguationMath: PASS');
}

async function testWarmColdSymbolRegistryParity() {
  const tmpDir = makeTempDir('wb-symbol-prescan-');
  fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"test"}');
  fs.writeFileSync(path.join(tmpDir, 'src', 'a.js'), "import { b } from './b';\nexport const a = 1;");
  fs.writeFileSync(path.join(tmpDir, 'src', 'b.js'), "export const b = 2;");

  // 1. Cold start
  const container1 = new ServiceContainer({ quiet: true });
  await container1.initialize(tmpDir, 60000, { watch: false });
  const coldSize = container1._depGraph.symbolRegistry.exports.size;
  assert.ok(coldSize > 0, 'cold build must populate symbolRegistry');
  await container1.shutdown();

  // 2. Warm start — loadGraph facade must rebuild symbolRegistry
  const container2 = new ServiceContainer({ quiet: true });
  await container2.initialize(tmpDir, 60000, { watch: false });
  const warmSize = container2._depGraph.symbolRegistry.exports.size;
  assert.strictEqual(warmSize, coldSize, 'warm loadGraph must populate identical symbolRegistry as cold build');
  await container2.shutdown();

  cleanupTempDir(tmpDir);
  console.log('testWarmColdSymbolRegistryParity: PASS');
}

const fs = require('fs');

async function main() {
  testSymbolRegistryDisambiguationMath();
  await testWarmColdSymbolRegistryParity();
  console.log('symbol-prescan-registry-test: all passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
