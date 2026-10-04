#!/usr/bin/env node
'use strict';
// @contract
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const cases = [
  ['quiet-invalid-format', ['workspace-info', '--format', 'invalid-u27', '--quiet']],
  ['json-invalid-format', ['workspace-info', '--format', 'invalid-u27', '--json', '--quiet']],
  ['fields-envelope', ['workspace-info', '--cwd', '.', '--json', '--quiet', '--fields', 'nonexistent-u27']],
];
const results = cases.map(([id, args]) => {
  const child = spawnSync(process.execPath, ['cli.js', ...args], { cwd: root, encoding: 'utf8', timeout: 180000 });
  let json = null;
  try { json = JSON.parse(child.stdout); } catch {}
  return { id, args, status: child.status, signal: child.signal, error: child.error?.message || null,
    stdout: child.stdout, stderr: child.stderr, keys: json ? Object.keys(json) : null };
});
fs.writeFileSync(path.join(__dirname, 'truth', 'u27-coldread', 'cli-probes.json'), `${JSON.stringify({ node: process.version, platform: process.platform, results }, null, 2)}\n`);
console.log(JSON.stringify(results.map(({ id, status, signal, error, stderr, keys }) => ({ id, status, signal, error, stderr, keys })), null, 2));
if (results.some((r) => r.error || r.signal)) process.exitCode = 1;
