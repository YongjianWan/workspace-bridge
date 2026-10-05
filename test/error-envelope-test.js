#!/usr/bin/env node
// @slow
// @contract — every error the CLI raises leaves through one envelope (ok:false, error, errorType,
// suggestion, command, schemaVersion), and failures whose fix is not obvious say what to do next.
const assert = require('assert');
const path = require('path');
const { buildCliError } = require('../src/cli/error-envelope');
const { failure, typedError, ERROR_TYPES, SUGGESTIONS } = require('../src/utils/failure');
const { classifyError } = require('../src/cli/validate-args');
const fs = require('fs');
const { makeTempDir, cleanupTempDir, runCliRaw } = require('./test-helpers');
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

function testFailureShapeAndTypes() {
  assert.deepStrictEqual(failure('path_error', 'm'), { ok: false, errorType: 'path_error', error: 'm', suggestion: SUGGESTIONS.path_error });
  assert.strictEqual(failure('git_error', 'm', { suggestion: 'own', file: 'a' }).suggestion, 'own', 'a site can replace the default suggestion');
  assert.strictEqual(failure('git_error', 'm', { file: 'a' }).file, 'a');
  assert.throws(() => failure('path_eror', 'm'), /Unknown error type/);
  assert.ok(ERROR_TYPES.every((type) => SUGGESTIONS[type].length > 10), 'every type has a real suggestion');
}

function testClassifyErrorTrustsTypesNotWords() {
  assert.strictEqual(classifyError(typedError('config_error', 'x')).type, 'config_error');
  assert.strictEqual(classifyError(Object.assign(new Error('x'), { code: 'ENOENT' })).type, 'path_error');
  assert.strictEqual(classifyError(Object.assign(new Error('x'), { code: 'EACCES' })).type, 'permission_error');
  assert.strictEqual(classifyError(new Error("Cannot read properties of undefined (reading 'initialize')")).type, 'unexpected_error',
    'a message that merely contains "init" is not an init failure');
  assert.strictEqual(classifyError(new Error('thing not found in table')).type, 'unexpected_error', '"not found" alone is not a path error');
  assert.throws(() => typedError('nope', 'x'), /Unknown error type/);
}

async function testToolFailuresCarryTheirType() {
  const check = async (args, type) => {
    const body = parseJson(await runCliInProcessRaw([...args, '--json', '--quiet']));
    assert.strictEqual(body.ok, false, args.join(' '));
    assert.strictEqual(body.errorType, type, `${args.join(' ')} -> ${body.errorType}`);
    assert.ok(body.suggestion, 'every typed failure says what to do next');
  };
  await check(['impact', '--cwd', REPO_ROOT, '--file', 'no-such-file.js'], 'path_error');
  await check(['guard', '--cwd', REPO_ROOT], 'validation_error');
  await check(['audit-diff', '--cwd', REPO_ROOT, '--staged', '--commits', 'HEAD~1..HEAD'], 'validation_error');
  await check(['audit-diff', '--cwd', REPO_ROOT, '--commits', 'no-such-rev..HEAD'], 'git_error');
  await check(['query', '--cwd', REPO_ROOT, '--sql', 'DELETE FROM files'], 'query_error');
  await check(['api-contracts', '--cwd', REPO_ROOT], 'validation_error');
}

async function testBrokenConfigIsAConfigError() {
  const dir = makeTempDir('wb-envelope-config-');
  try {
    fs.writeFileSync(path.join(dir, '.workspace-bridge.json'), '{ not json');
    fs.writeFileSync(path.join(dir, 'a.js'), 'module.exports = 1;\n');
    const result = await runCliRaw(['audit-overview', '--cwd', dir, '--json', '--quiet'], { cwd: dir });
    assert.strictEqual(result.status, 1, 'config errors exit 1');
    const body = JSON.parse(result.stdout);
    assert.strictEqual(body.errorType, 'config_error');
    assert.ok(body.suggestion.includes('.workspace-bridge.json'), body.suggestion);
  } finally {
    cleanupTempDir(dir);
  }
}

(async () => {
  testFailureShapeAndTypes();
  testClassifyErrorTrustsTypesNotWords();
  await testToolFailuresCarryTheirType();
  await testBrokenConfigIsAConfigError();
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
