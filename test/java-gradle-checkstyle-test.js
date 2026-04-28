#!/usr/bin/env node
const assert = require('assert');
const { generateCommands } = require('../src/utils/stack-detector');

function main() {
  // Maven + checkstyle
  const mavenStack = {
    profile: 'java-first',
    packageManager: 'maven',
    java: {
      enabled: true,
      buildTool: 'maven',
      buildCommand: 'mvn',
      linters: ['checkstyle'],
    },
  };
  const mavenCmds = generateCommands(mavenStack, 'code', ['src/App.java']);
  const mavenCheckstyle = mavenCmds.smoke.find((c) => c.name === 'java-checkstyle');
  assert(mavenCheckstyle, 'Maven should have checkstyle command');
  assert(mavenCheckstyle.cmd.includes('checkstyle:check'), `Maven checkstyle command wrong: ${mavenCheckstyle.cmd}`);

  // Gradle + checkstyle
  const gradleStack = {
    profile: 'java-first',
    packageManager: 'gradle',
    java: {
      enabled: true,
      buildTool: 'gradle',
      buildCommand: 'gradle',
      linters: ['checkstyle'],
    },
  };
  const gradleCmds = generateCommands(gradleStack, 'code', ['src/App.java']);
  const gradleCheckstyle = gradleCmds.smoke.find((c) => c.name === 'java-checkstyle');
  assert(gradleCheckstyle, 'Gradle should have checkstyle command');
  assert(!gradleCheckstyle.cmd.includes('checkstyle:check'), `Gradle checkstyle should not use Maven syntax: ${gradleCheckstyle.cmd}`);
  assert(gradleCheckstyle.cmd.includes('checkstyleMain'), `Gradle checkstyle command wrong: ${gradleCheckstyle.cmd}`);

  console.log('java-gradle-checkstyle-test: ok');
}

main();
