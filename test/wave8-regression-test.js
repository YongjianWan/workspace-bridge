// @contract
// Wave 8 Dogfood regression: REPL vs CLI affected-tests distance consistency (#29)
// Mention-based distance no longer hard-coded (#25)
// --staged + --commits conflict detection (#28)
// Git stderr sanitization (#36)

const assert = require('assert');
const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function runCli(args) {
  const result = spawnSync(process.execPath, ['cli.js', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 5 * 1024 * 1024,
  });
  const text = (result.stdout || '').replace(/^\uFEFF/, '');
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text, _code: result.status };
  }
}

// #29: REPL vs CLI affected-tests distance consistency
{
  const file = 'src/services/container.js';
  const cli = runCli(['affected-tests', '--file', file, '--max-depth', '1', '--json', '--quiet']);
  const repl = runCli(['repl', '--eval', `affected-tests ${file} --max-depth 1`, '--json', '--quiet']);

  assert.ok(cli.ok, `CLI should succeed: ${cli.error}`);
  assert.ok(repl.ok, `REPL should succeed: ${repl.error}`);
  assert.strictEqual(
    cli.affectedTestsCount,
    repl.result.affectedTestsCount,
    'CLI and REPL affected-tests count should match'
  );

  const cliByDist = cli.affectedTests.reduce((m, t) => {
    const key = t.distance == null ? 'null' : String(t.distance);
    m[key] = (m[key] || 0) + 1;
    return m;
  }, {});
  const replByDist = repl.result.affectedTests.reduce((m, t) => {
    const key = t.distance == null ? 'null' : String(t.distance);
    m[key] = (m[key] || 0) + 1;
    return m;
  }, {});
  assert.deepStrictEqual(cliByDist, replByDist, 'CLI and REPL distance distribution should match');
}

// #25: mention-based tests should have distance: null, not a hard-coded number
{
  const file = 'src/services/container.js';
  const cli = runCli(['affected-tests', '--file', file, '--json', '--quiet']);
  assert.ok(cli.ok);
  const mentionTests = cli.affectedTests.filter((t) => t.source === 'mention');
  for (const t of mentionTests) {
    assert.strictEqual(t.distance, null, `mention-based test should have distance=null, got ${t.distance}`);
  }
}

// #28: --staged + --commits should error
{
  const result = runCli(['audit-diff', '--staged', '--commits', 'HEAD~1..HEAD', '--json', '--quiet']);
  assert.strictEqual(result.ok, false, 'staged+commits should fail');
  assert.ok(result.error.includes('Cannot use --staged and --commits together'), `expected conflict error, got: ${result.error}`);
}

// #36: invalid git commit range should yield clean error (no raw stderr)
{
  const result = runCli(['audit-diff', '--commits', 'invalid..range', '--json', '--quiet']);
  assert.strictEqual(result.ok, false, 'invalid range should fail');
  assert.ok(!result.error.includes('fatal:'), `error should be sanitized, got: ${result.error}`);
  assert.ok(result.error.includes('Invalid git commit range') || result.error.includes('Failed to read git diff'), `expected clean error, got: ${result.error}`);
}

console.log('PASS: wave8-regression-test.js');
