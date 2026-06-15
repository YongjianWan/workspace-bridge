#!/usr/bin/env node
// @semantic
const assert = require('assert');
const { generateCommands } = require('../src/utils/stack-detector');

function main() {
  // --- Gradle multi-module: single module affected ---
  const gradleStack = {
    profile: 'java-first',
    packageManager: 'gradle',
    java: {
      enabled: true,
      buildTool: 'gradle',
      buildCommand: 'gradlew',
      linters: ['checkstyle'],
      subprojects: [
        { name: ':app', dir: 'app' },
        { name: ':lib', dir: 'lib' },
      ],
    },
  };

  const singleModule = generateCommands(gradleStack, 'code', ['app/src/main/java/App.java']);
  const compileCheck = singleModule.smoke.find((c) => c.name === 'java-compile-check');
  assert(compileCheck, 'Gradle multi-module should have compile check');
  assert(compileCheck.cmd.includes(':app:classes'), `Gradle compile should target module: ${compileCheck.cmd}`);
  assert(!compileCheck.cmd.includes(':lib:classes'), `Gradle compile should not target unaffected module: ${compileCheck.cmd}`);

  const focusedTest = singleModule.focused.find((c) => c.name === 'java-focused-tests');
  assert(focusedTest, 'Gradle multi-module should have focused tests');
  assert(focusedTest.cmd.includes(':app:test'), `Gradle focused test should target module: ${focusedTest.cmd}`);

  const checkstyle = singleModule.smoke.find((c) => c.name === 'java-checkstyle');
  assert(checkstyle, 'Gradle multi-module should have checkstyle');
  assert(checkstyle.cmd.includes(':app:checkstyleMain'), `Gradle checkstyle should target module: ${checkstyle.cmd}`);
  assert(checkstyle.cmd.includes(':app:checkstyleTest'), `Gradle checkstyle should include test check: ${checkstyle.cmd}`);

  // --- Gradle multi-module: multiple modules affected ---
  const multiModule = generateCommands(gradleStack, 'code', ['app/src/main/java/App.java', 'lib/src/main/java/Lib.java']);
  const multiCompile = multiModule.smoke.find((c) => c.name === 'java-compile-check');
  assert(multiCompile.cmd.includes(':app:classes'), `Multi-module compile should include :app:classes: ${multiCompile.cmd}`);
  assert(multiCompile.cmd.includes(':lib:classes'), `Multi-module compile should include :lib:classes: ${multiCompile.cmd}`);

  const multiFocused = multiModule.focused.find((c) => c.name === 'java-focused-tests');
  assert(multiFocused.cmd.includes(':app:test'), `Multi-module focused should include :app:test: ${multiFocused.cmd}`);
  assert(multiFocused.cmd.includes(':lib:test'), `Multi-module focused should include :lib:test: ${multiFocused.cmd}`);

  const multiCheckstyle = multiModule.smoke.find((c) => c.name === 'java-checkstyle');
  assert(multiCheckstyle.cmd.includes(':app:checkstyleMain'), `Multi-module checkstyle should include :app:checkstyleMain: ${multiCheckstyle.cmd}`);
  assert(multiCheckstyle.cmd.includes(':lib:checkstyleMain'), `Multi-module checkstyle should include :lib:checkstyleMain: ${multiCheckstyle.cmd}`);

  // --- Gradle single-module (no subprojects): fallback to full tasks ---
  const singleModuleStack = {
    profile: 'java-first',
    packageManager: 'gradle',
    java: {
      enabled: true,
      buildTool: 'gradle',
      buildCommand: 'gradlew',
      linters: [],
    },
  };
  const single = generateCommands(singleModuleStack, 'code', ['src/main/java/App.java']);
  const singleCompile = single.smoke.find((c) => c.name === 'java-compile-check');
  assert(singleCompile.cmd.includes('classes'), `Single-module Gradle should have classes task: ${singleCompile.cmd}`);
  assert(!singleCompile.cmd.includes(':'), `Single-module Gradle should not have module prefix: ${singleCompile.cmd}`);

  // --- Gradle multi-module: file outside known modules -> fallback ---
  const outsideFile = generateCommands(gradleStack, 'code', ['unknown/src/main/java/App.java']);
  const outsideCompile = outsideFile.smoke.find((c) => c.name === 'java-compile-check');
  assert(outsideCompile.cmd.includes('classes'), `Unknown module file should fallback: ${outsideCompile.cmd}`);
  assert(!outsideCompile.cmd.includes(':app:'), `Unknown module file should not target known module: ${outsideCompile.cmd}`);

  // --- Gradle multi-module: direct tests via steps ---
  // When direct tests resolve to the same cmd as focused tests, addUniqueCommand dedupes.
  const directSteps = [{ name: 'run-direct-tests', targets: ['app/src/main/java/App.java'] }];
  const directResult = generateCommands(gradleStack, 'code', ['app/src/main/java/App.java'], directSteps);
  const focusedTestCmds = directResult.focused.filter((c) => c.cmd && c.cmd.includes(':app:test'));
  assert.strictEqual(focusedTestCmds.length, 1, 'Gradle multi-module should dedupe identical focused/direct test commands');
  assert(focusedTestCmds[0].cmd.includes(':app:test'), `Focused/direct test should target module: ${focusedTestCmds[0].cmd}`);

  // --- Gradle multi-module nested path: lib:core ---
  const nestedStack = {
    profile: 'java-first',
    packageManager: 'gradle',
    java: {
      enabled: true,
      buildTool: 'gradle',
      buildCommand: 'gradlew',
      linters: [],
      subprojects: [
        { name: ':lib:core', dir: 'lib/core' },
      ],
    },
  };
  const nestedResult = generateCommands(nestedStack, 'code', ['lib/core/src/main/java/Core.java']);
  const nestedCompile = nestedResult.smoke.find((c) => c.name === 'java-compile-check');
  assert(nestedCompile.cmd.includes(':lib:core:classes'), `Nested module compile should target :lib:core:classes: ${nestedCompile.cmd}`);
}

main();
