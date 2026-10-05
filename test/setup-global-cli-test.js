#!/usr/bin/env node
// @fast
// @semantic
/**
 * setup-global-cli.ps1 must stop with a non-zero exit code when a step fails,
 * and print the completion banner only when every step succeeded.
 * PowerShell-only: skipped on other platforms.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

if (process.platform !== 'win32') {
  console.log('skipped: Windows PowerShell only');
  process.exit(0);
}

const script = path.resolve(__dirname, '../setup-global-cli.ps1');
const shell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');

function runSetup({ npmExit, cliExit }) {
  const dir = makeTempDir('wb-setup-');
  try {
    fs.writeFileSync(path.join(dir, 'node.cmd'), '@echo off\necho v25.6.0\nexit /b 0\n');
    fs.writeFileSync(path.join(dir, 'npm.cmd'), `@echo off\nexit /b ${npmExit}\n`);
    fs.writeFileSync(path.join(dir, 'workspace-bridge-cli.cmd'), `@echo off\necho {}\nexit /b ${cliExit}\n`);
    const env = { ...process.env, PATH: `${dir};${path.dirname(shell)};${process.env.SystemRoot}/System32` };
    const run = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
      { cwd: dir, encoding: 'utf8', timeout: 30000, env });
    assert(!run.error, `spawn failed: ${run.error && run.error.message}`);
    return run;
  } finally {
    cleanupTempDir(dir);
  }
}

const ok = runSetup({ npmExit: 0, cliExit: 0 });
assert.strictEqual(ok.status, 0, ok.stdout + ok.stderr);
assert(ok.stdout.includes('Setup complete'), 'success path must print the completion banner');

// CLI is missing and `npm link` fails: setup cannot succeed.
const linkFail = runSetup({ npmExit: 23, cliExit: 24 });
assert.notStrictEqual(linkFail.status, 0, 'npm link failure must exit non-zero');
assert(!linkFail.stdout.includes('Setup complete'), 'npm link failure must not print the completion banner');

// `npm link` succeeds but the installed CLI does not run.
const cliFail = runSetup({ npmExit: 0, cliExit: 24 });
assert.notStrictEqual(cliFail.status, 0, 'CLI verification failure must exit non-zero');
assert(!cliFail.stdout.includes('Setup complete'), 'CLI failure must not print the completion banner');
