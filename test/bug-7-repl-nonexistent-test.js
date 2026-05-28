// @slow
// @semantic
const assert = require('assert');
const { spawnSync } = require('child_process');
const path = require('path');

function main() {
  const cliPath = path.resolve(__dirname, '../cli.js');

  // Test 1: Plain text error and exit code 1
  const run1 = spawnSync('node', [cliPath, 'repl', '--eval', 'dependencies nonexistent.js', '--quiet']);
  const stdout1 = run1.stdout.toString().trim();
  const stderr1 = run1.stderr.toString().trim();

  assert.strictEqual(run1.status, 1, 'REPL eval of nonexistent file should return exit status 1');
  assert(stdout1.includes('Error: File not found in graph: nonexistent.js'), 'Output should contain clear error message');

  // Test 2: JSON error and exit code 1
  const run2 = spawnSync('node', [cliPath, 'repl', '--eval', 'dependencies nonexistent.js', '--json', '--quiet']);
  const stdout2 = run2.stdout.toString().trim();

  assert.strictEqual(run2.status, 1, 'REPL eval of nonexistent file in JSON mode should return exit status 1');
  const json2 = JSON.parse(stdout2);
  assert.strictEqual(json2.ok, false);
  assert(json2.error.includes('File not found in graph: nonexistent.js'));

  // Test 3: Standard working nonexistent.js in impact
  const run3 = spawnSync('node', [cliPath, 'repl', '--eval', 'impact nonexistent.js', '--quiet']);
  assert.strictEqual(run3.status, 1);
  assert(run3.stdout.toString().includes('Error: File not found in graph: nonexistent.js'));

  // Test 4: Standard working nonexistent.js in tree
  const run4 = spawnSync('node', [cliPath, 'repl', '--eval', 'tree nonexistent.js', '--quiet']);
  assert.strictEqual(run4.status, 1);
  assert(run4.stdout.toString().includes('Error: File not found in graph: nonexistent.js'));

  console.log('test/bug-7-repl-nonexistent-test.js ... PASS');
}

main();
