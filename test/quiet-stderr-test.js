#!/usr/bin/env node
// @fast
// @semantic
/**
 * Under --quiet stderr stays empty: a degraded run reports itself through warnings[] in the
 * result, and prints to stderr only when --quiet is not given.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

const CLI = path.join(__dirname, '..', 'cli.js');
const root = makeTempDir('wb-quiet-stderr-');
try {
  // A preload that makes @babel/parser unavailable, as in a package installed without it.
  const preload = path.join(root, 'no-babel.js');
  fs.writeFileSync(preload, [
    "const Module = require('module');",
    'const load = Module._load;',
    'Module._load = function (request, ...rest) {',
    "  if (request === '@babel/parser' || request.startsWith('@babel/parser/')) {",
    "    const error = new Error(`Cannot find module '${request}'`);",
    "    error.code = 'MODULE_NOT_FOUND';",
    '    throw error;',
    '  }',
    '  return load.call(this, request, ...rest);',
    '};',
    '',
  ].join(String.fromCharCode(10)));

  const project = path.join(root, 'project');
  fs.mkdirSync(path.join(project, 'src'), { recursive: true });
  fs.writeFileSync(path.join(project, 'package.json'), '{"name":"quiet"}');
  fs.writeFileSync(path.join(project, 'src', 'ok.js'), 'const a = 1;\nmodule.exports = a;\n');

  const run = (extra) => spawnSync(process.execPath, ['-r', preload, CLI, 'audit-overview', '--cwd', project, '--cache-dir', path.join(root, 'cache'), '--format', 'ai', ...extra], { encoding: 'utf8', timeout: 90000 });

  const quiet = run(['--quiet']);
  assert.strictEqual(quiet.status, 0, quiet.stderr);
  assert.strictEqual(quiet.stderr, '', `--quiet must leave stderr empty, got:\n${quiet.stderr}`);
  const result = JSON.parse(quiet.stdout);
  assert(/regex/i.test(JSON.stringify(result)), 'the degraded parsing is reported in the result instead');

  const loud = run([]);
  assert(/@babel\/parser not available/.test(loud.stderr), 'without --quiet the notice is printed');
} finally {
  cleanupTempDir(root);
}
