#!/usr/bin/env node
// @contract
/**
 * `--json` contract: the set of key paths (with value types) each command emits on a fixed
 * fixture repository. Removing a key or changing its type is a breaking change; adding one is
 * allowed but must be recorded by regenerating the snapshot:
 *   UPDATE_GOLDENS=1 node test/json-contract-snapshot-test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { makeTempDir, cleanupTempDir, runCli } = require('./test-helpers');

const GOLDEN = path.join(__dirname, 'fixtures', 'json-contract.json');
const MAX_DEPTH = 4;

function typeOf(value) {
  if (value === null) return 'null';
  return Array.isArray(value) ? 'array' : typeof value;
}

// Keys that are themselves data (paths, ids) are collapsed so the snapshot does not depend on
// the fixture's temp directory.
function keyLabel(key) {
  return /[/\x5c:]/.test(key) ? '<key>' : key;
}

function collect(value, prefix, depth, out) {
  const t = typeOf(value);
  if (prefix) {
    if (!out.has(prefix)) out.set(prefix, new Set());
    out.get(prefix).add(t);
  }
  if (depth >= MAX_DEPTH) return;
  if (Array.isArray(value)) {
    for (const item of value) collect(item, `${prefix}[]`, depth + 1, out);
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) collect(child, prefix ? `${prefix}.${keyLabel(key)}` : keyLabel(key), depth + 1, out);
  }
}

function keyPaths(json) {
  const out = new Map();
  collect(json, '', 0, out);
  return [...out.entries()].map(([p, types]) => `${p}:${[...types].sort().join('|')}`).sort();
}

function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 30000 });
  assert.strictEqual(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
}

function buildFixture(root) {
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, 'test'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture', scripts: { test: 'node test/a.test.js' } }));
  fs.writeFileSync(path.join(root, 'src', 'a.js'), "const b = require('./b');\nexports.run = () => b.value;\nexports.unused = 1;\n");
  fs.writeFileSync(path.join(root, 'src', 'b.js'), "const a = require('./a');\nexports.value = 1;\nexports.peek = () => a.run;\n");
  fs.writeFileSync(path.join(root, 'src', 'c.js'), "const missing = require('./missing');\nmodule.exports = missing;\n");
  fs.writeFileSync(path.join(root, 'src', 'secret.js'), "const pw = 'hunter2hunter2';\nmodule.exports = pw;\n");
  fs.writeFileSync(path.join(root, 'test', 'a.test.js'), "const a = require('../src/a');\nrequire('assert').ok(a.run());\n");
  git(root, ['init', '-q']);
  git(root, ['config', 'user.name', 'fixture']);
  git(root, ['config', 'user.email', 'fixture@example.com']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'init']);
  fs.appendFileSync(path.join(root, 'src', 'a.js'), '// edit\n');
}

const COMMANDS = [
  ['audit-overview', []],
  ['audit-map', []],
  ['impact', ['--file', 'src/a.js']],
  ['affected-tests', ['--file', 'src/a.js']],
  ['audit-diff', []],
  ['cycles', []],
  ['dead-exports', []],
  ['audit-security', []],
  ['workspace-info', []],
];

const root = makeTempDir('wb-json-contract-');
try {
  buildFixture(root);
  const actual = {};
  for (const [command, extra] of COMMANDS) {
    const json = runCli([command, '--cwd', root, '--cache-dir', path.join(root, '.cache-out'), '--json', '--quiet', ...extra]);
    actual[command] = keyPaths(json);
  }

  if (process.env.UPDATE_GOLDENS) {
    fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
    fs.writeFileSync(GOLDEN, JSON.stringify(actual, null, 2) + '\n', 'utf8');
    console.log('Updated JSON contract snapshot');
  } else {
    assert(fs.existsSync(GOLDEN), 'snapshot missing: run UPDATE_GOLDENS=1 node test/json-contract-snapshot-test.js');
    const expected = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
    for (const [command] of COMMANDS) {
      const have = new Set(actual[command]);
      const want = new Set(expected[command] || []);
      const removed = [...want].filter((p) => !have.has(p));
      const added = [...have].filter((p) => !want.has(p));
      assert.deepStrictEqual(removed, [], `${command}: keys removed or retyped (breaking): ${removed.join(', ')}`);
      assert.deepStrictEqual(added, [], `${command}: new keys not in the snapshot; record them with UPDATE_GOLDENS=1: ${added.join(', ')}`);
    }
  }
} finally {
  cleanupTempDir(root);
}
