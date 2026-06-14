// @contract
// Wave 8 Dogfood regression: REPL vs CLI affected-tests distance consistency (#29)
// Mention-based distance no longer hard-coded (#25)
// --staged + --commits conflict detection (#28)
// Git stderr sanitization (#36)

const assert = require('assert');
const { spawnSync } = require('child_process');
const path = require('path');
const { runCliInProcess, runCliInProcessRaw } = require('./test-helpers');

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

async function main() {
  // #29: REPL vs CLI affected-tests distance consistency
  {
    const file = 'src/services/container.js';
    const cli = await runCliInProcess(['affected-tests', '--file', file, '--max-depth', '1', '--json', '--quiet']);
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

  // #25: mention-based tests should have distance: maxDepth+1 with terminator flag,
  // not a hard-coded number and not null (null breaks numeric comparisons).
  {
    const file = 'src/services/container.js';
    const cli = await runCliInProcess(['affected-tests', '--file', file, '--json', '--quiet']);
    assert.ok(cli.ok);
    const maxDepth = 5; // default
    const mentionTests = cli.affectedTests.filter((t) => t.source === 'mention');
    for (const t of mentionTests) {
      assert.strictEqual(t.distance, maxDepth + 1, `mention-based test should have distance=${maxDepth + 1}, got ${t.distance}`);
      assert.strictEqual(t.terminator, true, `mention-based test should have terminator=true`);
    }
  }

  // #28: --staged + --commits should error
  {
    const result = await runCliInProcessRaw(['audit-diff', '--staged', '--commits', 'HEAD~1..HEAD', '--json', '--quiet']);
    const parsed = JSON.parse(result.stdout.replace(/^\uFEFF/, ''));
    assert.strictEqual(parsed.ok, false, 'staged+commits should fail');
    assert.ok(parsed.error.includes('Cannot use --staged and --commits together'), `expected conflict error, got: ${parsed.error}`);
  }

  // #36: invalid git commit range should yield clean error (no raw stderr)
  {
    const result = await runCliInProcessRaw(['audit-diff', '--commits', 'invalid..range', '--json', '--quiet']);
    const parsed = JSON.parse(result.stdout.replace(/^\uFEFF/, ''));
    assert.strictEqual(parsed.ok, false, 'invalid range should fail');
    assert.ok(!parsed.error.includes('fatal:'), `error should be sanitized, got: ${parsed.error}`);
    assert.ok(parsed.error.includes('Invalid git commit range') || parsed.error.includes('Failed to read git diff'), `expected clean error, got: ${parsed.error}`);
  }

  console.log('PASS: wave8-regression-test.js');
}

main();
