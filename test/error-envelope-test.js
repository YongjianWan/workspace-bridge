#!/usr/bin/env node
// @contract — every error the CLI raises leaves through one envelope (ok:false, error, errorType,
// suggestion, command, schemaVersion), and failures whose fix is not obvious say what to do next.
const assert = require('assert');
const path = require('path');
const { buildCliError } = require('../src/cli/error-envelope');
const { runCliInProcess } = require('../cli');
const { runCliInProcessRaw } = require('./test-helpers');

const REPO_ROOT = path.join(__dirname, '..');
const ENVELOPE_KEYS = ['command', 'error', 'errorType', 'ok', 'schemaVersion', 'suggestion'];

function parseJson(response) {
  assert.ok(response.stdout, `expected JSON on stdout, got stderr: ${response.stderr}`);
  return JSON.parse(response.stdout);
}

function testBuildCliErrorShapes() {
  const json = buildCliError({ json: true, type: 'path_error', message: 'm', suggestion: 's', status: 1, command: 'impact' });
  assert.deepStrictEqual(Object.keys(JSON.parse(json.stdout)).sort(), ENVELOPE_KEYS);
  assert.strictEqual(json.stderr, '');
  const text = buildCliError({ json: false, type: 'path_error', message: 'm', suggestion: 's', status: 1 });
  assert.strictEqual(text.stderr, '[path_error] m\n→ s');
  assert.strictEqual(text.stdout, '');
  assert.throws(() => buildCliError({ json: true, type: 'path_eror', message: 'm', suggestion: 's', status: 1 }), /Unknown CLI error type/);
}

async function testMissingCwdIsAnEnvelopeAndHasNoSideEffects() {
  const logged = [];
  const originalLog = console.log;
  const originalExitCode = process.exitCode;
  console.log = (...args) => logged.push(args.join(' '));
  let json;
  let text;
  try {
    json = await runCliInProcess(['impact', '--cwd', path.join(REPO_ROOT, 'no-such-dir'), '--file', 'a.js', '--json', '--quiet']);
    text = await runCliInProcess(['impact', '--cwd', path.join(REPO_ROOT, 'no-such-dir'), '--file', 'a.js', '--quiet']);
  } finally {
    console.log = originalLog;
  }
  assert.strictEqual(process.exitCode, originalExitCode, 'the in-process runner must not set the process exit code');
  assert.deepStrictEqual(logged, [], 'the in-process runner must not print; it returns the response');
  assert.strictEqual(json.status, 1);
  const body = parseJson(json);
  assert.deepStrictEqual(Object.keys(body).sort(), ENVELOPE_KEYS);
  assert.strictEqual(body.command, 'impact');
  assert.strictEqual(body.errorType, 'path_error');
  assert.ok(/--cwd/.test(body.suggestion), 'the suggestion names --cwd');
  assert.ok(text.stderr.startsWith('[path_error] Directory not found:') && text.stderr.includes('\n→ '), text.stderr);
}

async function testPathEscapeSaysWhatToPass() {
  const body = parseJson(await runCliInProcess(['impact', '--cwd', REPO_ROOT, '--file', '../../outside.js', '--json', '--quiet']));
  assert.strictEqual(body.errorType, 'path_error');
  assert.ok(/relative to --cwd/.test(body.suggestion), body.suggestion);
}

async function testParseFailureCarriesCommandAndType() {
  const bad = await runCliInProcess(['audit-overview', '--cwd', REPO_ROOT, '--format', 'xml', '--json']);
  assert.strictEqual(bad.status, 1);
  const body = parseJson(bad);
  assert.deepStrictEqual(Object.keys(body).sort(), ENVELOPE_KEYS);
  assert.strictEqual(body.command, 'audit-overview');
  assert.strictEqual(body.errorType, 'validation_error');
}

async function testUnknownCommandKeepsItsDocumentedExitCode() {
  const unknown = await runCliInProcess(['bogus', '--cwd', REPO_ROOT, '--json', '--quiet']);
  assert.strictEqual(unknown.status, 2, 'unknown command exits CLI_ERROR (2), locked by exit-codes.js');
  const body = parseJson(unknown);
  assert.strictEqual(body.command, 'bogus');
  assert.deepStrictEqual(Object.keys(body).sort(), ENVELOPE_KEYS);
}

async function testToolLevelFailuresSayWhatToDoNext() {
  const missing = parseJson(await runCliInProcessRaw(['impact', '--cwd', REPO_ROOT, '--file', 'no-such-file.js', '--json', '--quiet']));
  assert.strictEqual(missing.ok, false);
  assert.ok(/relative to --cwd/.test(missing.suggestion), 'File not found explains how --file is resolved');

  const guard = parseJson(await runCliInProcessRaw(['guard', '--cwd', REPO_ROOT, '--json', '--quiet']));
  assert.ok(/--files/.test(guard.suggestion) && /--staged/.test(guard.suggestion), 'guard explains the three target options');

  const range = parseJson(await runCliInProcessRaw(['audit-diff', '--cwd', REPO_ROOT, '--commits', 'no-such-rev..HEAD', '--json', '--quiet']));
  assert.ok(range.suggestion.includes('no-such-rev..HEAD') && range.suggestion.includes('HEAD~9..HEAD'), 'the bad revision is echoed with an example');

  const human = await runCliInProcessRaw(['impact', '--cwd', REPO_ROOT, '--file', 'no-such-file.js', '--quiet']);
  assert.ok(human.stdout.includes('\n→ '), 'text formats show the suggestion under the error');
}

(async () => {
  testBuildCliErrorShapes();
  await testMissingCwdIsAnEnvelopeAndHasNoSideEffects();
  await testPathEscapeSaysWhatToPass();
  await testParseFailureCarriesCommandAndType();
  await testUnknownCommandKeepsItsDocumentedExitCode();
  await testToolLevelFailuresSayWhatToDoNext();
  console.log('error-envelope-test: OK');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
