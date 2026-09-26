#!/usr/bin/env node
// @semantic
// @slow
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

const root = makeTempDir('wb-restored-mtime-cli-');
const cli = path.resolve(__dirname, '..', 'cli.js');
function dependents(file) {
  const result = spawnSync(process.execPath, [cli, 'dependents', '--cwd', root, '--file', file, '--json', '--quiet'], {
    encoding: 'utf8',
  });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout).dependents.map((entry) => path.basename(typeof entry === 'string' ? entry : entry.file));
}

try {
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"fixture"}');
  fs.writeFileSync(path.join(root, 'a.ts'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(root, 'b.ts'), 'export const b = 2;\n');
  const main = path.join(root, 'main.ts');
  const original = 'import { a } from "./a";\n';
  const replacement = 'import { b } from "./b";\n';
  assert.strictEqual(original.length, replacement.length);
  const fixedTime = new Date('2020-01-01T00:00:00Z');
  fs.writeFileSync(main, original);
  fs.utimesSync(main, fixedTime, fixedTime);
  assert(dependents('a.ts').includes('main.ts'));

  fs.writeFileSync(main, replacement);
  fs.utimesSync(main, fixedTime, fixedTime);
  assert(dependents('b.ts').includes('main.ts'), 'warm CLI must reparse changed content');
  assert(!dependents('a.ts').includes('main.ts'), 'old edge must be removed');
} finally {
  cleanupTempDir(root);
}
