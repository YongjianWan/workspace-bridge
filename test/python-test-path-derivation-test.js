#!/usr/bin/env node
// @semantic
const assert = require('assert');
const path = require('path');
const {
  derivePythonTestCandidates,
  findExistingTestFiles,
  generateCommands,
} = require('../src/utils/stack-detector');

const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'python-test-paths');

function testDjangoAppTestCandidate() {
  const candidates = derivePythonTestCandidates('gov_workbench/management/commands/collect_retrieval_badcases.py');
  assert(candidates.includes('gov_workbench/tests/test_collect_retrieval_badcases.py'), 'Django app tests/ candidate missing');
  assert(candidates.includes('gov_workbench/tests.py'), 'Django app tests.py candidate missing');
  assert(candidates.includes('tests/test_collect_retrieval_badcases.py'), 'project-level tests/ candidate missing');
  assert(candidates.includes('gov_workbench/management/commands/test_collect_retrieval_badcases.py'), 'same-dir test candidate missing');
}

function testProjectLevelTestCandidate() {
  const candidates = derivePythonTestCandidates('app/utils.py');
  assert(candidates.includes('tests/test_utils.py'), 'project-level test_utils.py candidate missing');
  assert(candidates.includes('app/tests/test_utils.py'), 'app-level tests/ candidate missing');
  assert(candidates.includes('app/test_utils.py'), 'same-dir test candidate missing');
}

function testFindExistingTestFiles() {
  const found = findExistingTestFiles(FIXTURE_ROOT, [
    'gov_workbench/management/commands/collect_retrieval_badcases.py',
    'app/utils.py',
  ]);
  assert.deepStrictEqual(found, [
    'gov_workbench/tests/test_collect_retrieval_badcases.py',
    'tests/test_utils.py',
  ]);
}

function testGenerateCommandsMapsToExistingTest() {
  const stack = {
    profile: 'python-first',
    packageManager: 'pip',
    python: { enabled: true, testRunner: 'pytest', linters: [], typeChecker: null, framework: 'django' },
  };
  const commands = generateCommands(
    stack,
    'code',
    ['gov_workbench/management/commands/collect_retrieval_badcases.py'],
    [],
    FIXTURE_ROOT
  );
  const focused = commands.focused.find((c) => c.name === 'python-focused-tests');
  assert(focused, 'python-focused-tests command should exist');
  assert.deepStrictEqual(focused.executable.args, [
    'gov_workbench/tests/test_collect_retrieval_badcases.py',
  ], 'focused test should point to existing test file, not source file');
}

function testGenerateCommandsOmitsFocusedWhenNoTestExists() {
  const stack = {
    profile: 'python-first',
    packageManager: 'pip',
    python: { enabled: true, testRunner: 'pytest', linters: [], typeChecker: null, framework: null },
  };
  const commands = generateCommands(
    stack,
    'code',
    ['nonexistent/module.py'],
    [],
    FIXTURE_ROOT
  );
  assert(!commands.focused.some((c) => c.name === 'python-focused-tests'), 'no focused tests when no matching test file exists');
  assert(commands.full.some((c) => c.name === 'python-all-tests'), 'full test suite should still be emitted');
}

function testLegacyBehaviorWithoutWorkspaceRoot() {
  const stack = {
    profile: 'python-first',
    packageManager: 'pip',
    python: { enabled: true, testRunner: 'pytest', linters: [], typeChecker: null, framework: null },
  };
  const commands = generateCommands(stack, 'code', ['src/app.py']);
  const focused = commands.focused.find((c) => c.name === 'python-focused-tests');
  assert(focused, 'legacy behavior should still emit focused tests');
  assert.deepStrictEqual(focused.executable.args, ['src/app.py'], 'legacy behavior passes source files directly');
}

function main() {
  testDjangoAppTestCandidate();
  testProjectLevelTestCandidate();
  testFindExistingTestFiles();
  testGenerateCommandsMapsToExistingTest();
  testGenerateCommandsOmitsFocusedWhenNoTestExists();
  testLegacyBehaviorWithoutWorkspaceRoot();
  console.log('test/python-test-path-derivation-test.js ... PASS');
}

main();
