#!/usr/bin/env node
// @semantic
const assert = require('assert');
const path = require('path');
const { probePythonTestEnvironment } = require('../src/utils/environment-probe');

const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'python-env-probe');

function djangoPytestStack() {
  return { enabled: true, framework: 'django', testRunner: 'pytest' };
}

function testDetectsMissingPytestDjango() {
  const root = path.join(FIXTURE_ROOT, 'django-missing');
  const notes = probePythonTestEnvironment(root, djangoPytestStack());
  const missing = notes.find((n) => n.type === 'missing-dependency');
  assert(missing, 'should flag missing pytest-django');
  assert(missing.message.includes('pytest-django'), 'message should mention pytest-django');
  assert(missing.remediation.includes('pip install pytest-django'), 'remediation should suggest install');
}

function testNoMissingNoteWhenDependencyPresent() {
  const root = path.join(FIXTURE_ROOT, 'django-ready');
  const notes = probePythonTestEnvironment(root, djangoPytestStack());
  assert(!notes.some((n) => n.type === 'missing-dependency'), 'should not flag pytest-django when present');
  assert(notes.some((n) => n.type === 'environment-prerequisite'), 'should still warn about database');
}

function testIgnoresNonDjangoStack() {
  const root = path.join(FIXTURE_ROOT, 'django-missing');
  const pythonStack = { enabled: true, framework: 'flask', testRunner: 'pytest' };
  const notes = probePythonTestEnvironment(root, pythonStack);
  assert.strictEqual(notes.length, 0, 'non-Django stack should have no notes');
}

function testIgnoresNonPytestRunner() {
  const root = path.join(FIXTURE_ROOT, 'django-missing');
  const pythonStack = { enabled: true, framework: 'django', testRunner: 'unittest' };
  const notes = probePythonTestEnvironment(root, pythonStack);
  assert.strictEqual(notes.length, 0, 'non-pytest runner should have no notes');
}

function main() {
  testDetectsMissingPytestDjango();
  testNoMissingNoteWhenDependencyPresent();
  testIgnoresNonDjangoStack();
  testIgnoresNonPytestRunner();
  console.log('test/python-environment-probe-test.js ... PASS');
}

main();
