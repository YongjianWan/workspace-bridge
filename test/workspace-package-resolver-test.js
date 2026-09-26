// @semantic
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');
const { resolveImport } = require('../src/services/dep-graph/resolvers');

function write(root, file, content) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
}

const root = makeTempDir('wb-workspace-package-');
try {
  const importingFile = write(root, 'packages/app/src/main.ts', 'import { core } from "@acme/core";');
  const entry = write(root, 'packages/core/src/index.ts', 'export const core = 1;');
  write(root, 'packages/core/package.json', JSON.stringify({ name: '@acme/core', main: 'src/index.ts' }));
  write(root, 'packages/app/package.json', JSON.stringify({ name: '@acme/app', dependencies: { '@acme/core': '*' } }));

  write(root, 'package.json', JSON.stringify({ private: true, workspaces: ['packages/*'] }));
  assert.strictEqual(resolveImport(importingFile, '@acme/core', '.ts', root), entry);

  fs.rmSync(path.join(root, 'package.json'));
  write(root, 'pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n");
  assert.strictEqual(resolveImport(importingFile, '@acme/core', '.ts', root), entry);
  assert.strictEqual(resolveImport(importingFile, '@acme/missing', '.ts', root), null);
  console.log('workspace-package-resolver-test: PASS');
} finally {
  cleanupTempDir(root);
}
