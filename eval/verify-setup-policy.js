// @semantic — Actual installer control flow under process-scoped execution policies.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
if (process.platform !== 'win32') throw new Error('Windows-only execution-policy probe');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-setup-policy-'));
fs.writeFileSync(path.join(dir, 'node.cmd'), '@echo off\necho v25.6.0\nexit /b 0\n');
fs.writeFileSync(path.join(dir, 'npm.cmd'), '@echo off\necho Fixture: npm link failed 1>&2\nexit /b 23\n');
fs.writeFileSync(path.join(dir, 'workspace-bridge-cli.cmd'), '@echo off\necho Fixture: CLI unavailable 1>&2\nexit /b 24\n');
const shell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
const cases = ['Restricted', 'AllSigned', 'Bypass'].map((policy) => {
  const run = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', policy, '-File', path.resolve(__dirname, '../setup-global-cli.ps1')], { cwd: dir, encoding: 'utf8', timeout: 30000, env: { ...process.env, PATH: `${dir};${path.dirname(shell)};${process.env.SystemRoot}/System32` } });
  return { policy, exitCode: run.status, stdout: run.stdout, stderr: run.stderr, error: run.error?.message };
});
fs.writeFileSync(path.join(__dirname, 'truth/setup-policy.json'), JSON.stringify({ scope: 'Process policy only; not Group Policy. Real setup script, mocked failed npm/CLI; no real global installation or security setting changes', cases }, null, 2) + '\n');
console.log(JSON.stringify(cases));
