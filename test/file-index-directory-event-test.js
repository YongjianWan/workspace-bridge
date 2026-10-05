#!/usr/bin/env node
// @fast
// @semantic
/**
 * fs.watch reports directories too. A directory event must not reach
 * pending:processed or file:changed, otherwise the dependency graph tries to
 * read it as a source file (EISDIR).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');
const { FileIndex } = require('../src/services/file-index');
const { WorkspaceCache } = require('../src/services/cache');

async function main() {
  const root = makeTempDir('wb-dir-event-');
  fs.mkdirSync(path.join(root, 'pkg'));
  fs.writeFileSync(path.join(root, 'pkg', 'a.js'), 'export const a = 1;\n');

  const index = new FileIndex(root, new WorkspaceCache(root));
  await index.build(30000, { watch: false });
  index.active = true;

  const processed = [];
  const changed = [];
  index.bus.on('pending:processed', (files) => processed.push(...files));
  index.bus.on('file:changed', (f) => changed.push(f));

  const dir = path.join(root, 'pkg');
  const file = path.join(root, 'pkg', 'a.js');
  index.pendingUpdates.add(dir);
  index.pendingUpdates.add(file);
  await index.processPending();

  assert(processed.includes(file), 'file event must be forwarded');
  assert(!processed.includes(dir), 'directory event must not reach pending:processed');
  assert(!changed.includes(dir), 'directory event must not reach file:changed');

  cleanupTempDir(root);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
