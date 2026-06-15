#!/usr/bin/env node
// @contract
/**
 * CLI exit-code semantics integration test.
 * Verifies the contract:
 *   0 = success (or success with findings when --fail-on-findings is absent)
 *   1 = business failure / findings (only with --fail-on-findings)
 *   2 = crash / unhandled exception
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { runCliInProcessRaw, makeTempDir, cleanupTempDir } = require('./test-helpers');

function writeFile(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

async function run(args, opts = {}) {
  return await runCliInProcessRaw(args, { cwd: opts.cwd, timeout: opts.timeout || 30000 });
}

async function testExitCodeSuccess() {
  const tempRoot = makeTempDir('wb-exit-ok-');
  try {
    writeFile(tempRoot, 'package.json', JSON.stringify({ name: 'ok', version: '1.0.0', main: 'src/a.js' }, null, 2));
    writeFile(tempRoot, 'src/a.js', 'export const a = 1;\n');

    const treeResult = await run(['tree', '--cwd', tempRoot, '--file', 'src/a.js', '--json', '--quiet']);
    assert.strictEqual(treeResult.status, 0, `tree with valid args should exit 0. stderr: ${treeResult.stderr}`);

    const impactResult = await run(['impact', '--cwd', tempRoot, '--file', 'src/a.js', '--json', '--quiet']);
    assert.strictEqual(impactResult.status, 0, `impact with valid args should exit 0. stderr: ${impactResult.stderr}`);
  } finally {
    cleanupTempDir(tempRoot);
  }
}

async function testExitCodeWithFindingsDefault() {
  const tempRoot = makeTempDir('wb-exit-findings-');
  try {
    writeFile(tempRoot, 'package.json', JSON.stringify({ name: 'biz', version: '1.0.0', main: 'src/index.js' }, null, 2));
    writeFile(tempRoot, 'src/lib.js', 'export function used() { return 1; }\nexport function unused() { return 2; }\n');
    writeFile(tempRoot, 'src/index.js', 'import { used } from "./lib";\nconsole.log(used());\n');

    // Without --fail-on-findings, dead-exports exits 0 even with findings
    const deadResult = await run(['dead-exports', '--cwd', tempRoot, '--json', '--quiet']);
    assert.strictEqual(deadResult.status, 0, 'dead-exports without --fail-on-findings should exit 0');
    const data = JSON.parse(deadResult.stdout);
    assert(data.deadExportsCount >= 1, 'should have dead export findings');

    // With --fail-on-findings, dead-exports exits 1
    const deadFailResult = await run(['dead-exports', '--cwd', tempRoot, '--json', '--quiet', '--fail-on-findings']);
    assert.strictEqual(deadFailResult.status, 1, 'dead-exports with --fail-on-findings should exit 1');
  } finally {
    cleanupTempDir(tempRoot);
  }
}

async function testExitCodeInvalidArgs() {
  const tempRoot = makeTempDir('wb-exit-arg-');
  try {
    writeFile(tempRoot, 'package.json', JSON.stringify({ name: 'arg', version: '1.0.0' }, null, 2));

    const noFileResult = await run(['tree', '--cwd', tempRoot, '--json', '--quiet']);
    assert.strictEqual(noFileResult.status, 1, 'tree without --file should exit 1 (validation error is business failure, not crash)');

    const badCwdResult = await run(['audit-summary', '--cwd', path.join(tempRoot, 'nonexistent'), '--json', '--quiet']);
    assert.strictEqual(badCwdResult.status, 1, 'invalid cwd should exit 1 (business failure)');
  } finally {
    cleanupTempDir(tempRoot);
  }
}

async function main() {
  await testExitCodeSuccess();
  await testExitCodeWithFindingsDefault();
  await testExitCodeInvalidArgs();
  console.log('cli-exit-code-test.js: all passed');
}

main();
