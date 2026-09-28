#!/usr/bin/env node
// @semantic
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-p2-5-path-'));
const project = path.join(fixture, 'project');
const outside = path.join(fixture, 'outside');
const frontend = path.join(project, 'frontend');
const backend = path.join(project, 'backend');
const cli = path.join(__dirname, '..', 'cli.js');

try {
  fs.mkdirSync(path.join(frontend, 'src'), { recursive: true });
  fs.mkdirSync(path.join(backend, 'src'), { recursive: true });
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(frontend, 'src', 'api.ts'), "import axios from 'axios'; export const getUsers = () => axios.get('/api/users');\n");
  fs.writeFileSync(path.join(backend, 'src', 'server.js'), "const express = require('express'); const app = express(); app.get('/api/users', (_req, res) => res.json([]));\n");

  const run = spawnSync(process.execPath, [cli, 'api-contracts', '--cwd', project, '--frontend', 'frontend', '--backend', 'backend', '--json', '--quiet'], {
    cwd: outside,
    env: { ...process.env, LOCALAPPDATA: path.join(fixture, 'localappdata') },
    encoding: 'utf8',
    timeout: 60000,
  });
  assert.strictEqual(run.status, 0, `api-contracts failed from outside workspace: ${run.stdout} ${run.stderr}`);
  const result = JSON.parse(run.stdout);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.frontend, frontend);
  assert.strictEqual(result.backend, backend);
  assert.strictEqual(result.matchedCount, 1, 'the resolved workspaces must be scanned');
  console.log('p2-5-api-contracts-path-test: PASS');
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
