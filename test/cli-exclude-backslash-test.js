#!/usr/bin/env node
// @contract
/**
 * Test that --exclude handles Windows backslash separators correctly.
 * Issue: Windows users naturally write --exclude src\views, which should
 * behave identically to --exclude src/views.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeTempDir, cleanupTempDir, runCliInProcessRaw } = require('./test-helpers');

function setupProject(root) {
  fs.mkdirSync(path.join(root, 'src', 'views'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src', 'components'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'test' }), 'utf8');
  fs.writeFileSync(path.join(root, 'src', 'app.js'), "import { x } from './views/page.js';\n");
  fs.writeFileSync(path.join(root, 'src', 'views', 'page.js'), 'export const x = 1;\n');
  fs.writeFileSync(path.join(root, 'src', 'components', 'btn.js'), 'export const btn = 1;\n');
}

function getParsedFiles(result) {
  try {
    const json = JSON.parse(result.stdout);
    return json.summary?.analysisCoverage?.parsedFiles ?? null;
  } catch {
    return null;
  }
}

async function testExcludeForwardSlash() {
  const root = makeTempDir('wb-exclude-fwd-');
  setupProject(root);

  const result = await runCliInProcessRaw(['audit-summary', '--json', '--quiet', '--cwd', root, '--exclude', 'src/views']);
  assert.strictEqual(result.status, 0, `CLI failed: ${result.stderr?.slice(0, 200)}`);
  const parsed = getParsedFiles(result);
  assert.strictEqual(parsed, 2, `Forward-slash exclude should leave 2 files, got ${parsed}`);

  cleanupTempDir(root);
}

async function testExcludeBackslashMatchesForwardSlash() {
  const root = makeTempDir('wb-exclude-bk-');
  setupProject(root);

  const fwd = await runCliInProcessRaw(['audit-summary', '--json', '--quiet', '--cwd', root, '--exclude', 'src/views']);
  const bwd = await runCliInProcessRaw(['audit-summary', '--json', '--quiet', '--cwd', root, '--exclude', 'src\\views']);
  assert.strictEqual(fwd.status, 0, `Forward-slash CLI failed: ${fwd.stderr?.slice(0, 200)}`);
  assert.strictEqual(bwd.status, 0, `Backslash CLI failed: ${bwd.stderr?.slice(0, 200)}`);

  const fwdParsed = getParsedFiles(fwd);
  const bwdParsed = getParsedFiles(bwd);
  assert.strictEqual(
    fwdParsed,
    bwdParsed,
    `Backslash exclude (${bwdParsed}) must match forward-slash exclude (${fwdParsed})`
  );

  cleanupTempDir(root);
}

async function testExcludeGlobBackslashConsistent() {
  const root = makeTempDir('wb-exclude-glob-');
  setupProject(root);

  const fwd = await runCliInProcessRaw(['audit-summary', '--json', '--quiet', '--cwd', root, '--exclude', 'src/views/*.js']);
  const bwd = await runCliInProcessRaw(['audit-summary', '--json', '--quiet', '--cwd', root, '--exclude', 'src\\views\\*.js']);
  assert.strictEqual(fwd.status, 0, `Forward-slash glob CLI failed: ${fwd.stderr?.slice(0, 200)}`);
  assert.strictEqual(bwd.status, 0, `Backslash glob CLI failed: ${bwd.stderr?.slice(0, 200)}`);

  const fwdParsed = getParsedFiles(fwd);
  const bwdParsed = getParsedFiles(bwd);
  assert.strictEqual(
    fwdParsed,
    bwdParsed,
    `Backslash-glob exclude (${bwdParsed}) must match forward-slash-glob exclude (${fwdParsed})`
  );

  cleanupTempDir(root);
}

async function testExcludeMixedSeparators() {
  const root = makeTempDir('wb-exclude-mix-');
  setupProject(root);

  // Mixed separator in a single directory name should still normalize correctly
  const result = await runCliInProcessRaw(['audit-summary', '--json', '--quiet', '--cwd', root, '--exclude', 'src\\components']);
  assert.strictEqual(result.status, 0, `CLI failed: ${result.stderr?.slice(0, 200)}`);
  const parsed = getParsedFiles(result);
  assert.strictEqual(parsed, 2, `Mixed-separator exclude should leave 2 files, got ${parsed}`);

  cleanupTempDir(root);
}

async function main() {
  await testExcludeForwardSlash();
  await testExcludeBackslashMatchesForwardSlash();
  await testExcludeGlobBackslashConsistent();
  await testExcludeMixedSeparators();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
