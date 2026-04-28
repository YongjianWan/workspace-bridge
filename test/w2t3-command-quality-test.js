#!/usr/bin/env node
const assert = require('assert');
const { generateCommands } = require('../src/utils/stack-detector');

function main() {
  // --- Go config: go.mod change should trigger smoke + full, no focused ---
  const goStack = {
    profile: 'go-first',
    packageManager: 'go modules',
    go: { enabled: true, packageManager: 'go modules', testRunner: 'go test' },
  };
  const goConfig = generateCommands(goStack, 'config', ['go.mod']);
  assert(goConfig.smoke.some((c) => c.name === 'go-build'), 'Go config should include go-build');
  assert(goConfig.full.some((c) => c.name === 'go-all-tests'), 'Go config should include go-all-tests');
  assert(!goConfig.focused.some((c) => c.name === 'go-focused-tests'), 'Go config should not include go-focused-tests without .go files');

  // --- Rust config: Cargo.toml change should trigger smoke + full, no focused ---
  const rustStack = {
    profile: 'rust-first',
    packageManager: 'cargo',
    rust: { enabled: true, packageManager: 'cargo', testRunner: 'cargo test' },
  };
  const rustConfig = generateCommands(rustStack, 'config', ['Cargo.toml']);
  assert(rustConfig.smoke.some((c) => c.name === 'rust-check'), 'Rust config should include rust-check');
  assert(rustConfig.full.some((c) => c.name === 'rust-all-tests'), 'Rust config should include rust-all-tests');
  assert(!rustConfig.focused.some((c) => c.name === 'rust-direct-tests'), 'Rust config should not include rust-direct-tests without .rs files');

  // --- Java config: pom.xml only should not generate focused tests ---
  const mavenStack = {
    profile: 'java-first',
    packageManager: 'maven',
    java: { enabled: true, buildTool: 'maven', buildCommand: 'mvn', linters: [] },
  };
  const mavenConfig = generateCommands(mavenStack, 'config', ['pom.xml']);
  assert(mavenConfig.smoke.some((c) => c.name === 'java-compile-check'), 'Maven config should include compile check');
  assert(!mavenConfig.focused.some((c) => c.name === 'java-focused-tests'), 'Maven config should not include focused tests without .java files');

  // --- Java code: .java change should generate focused tests ---
  const mavenCode = generateCommands(mavenStack, 'code', ['src/App.java']);
  assert(mavenCode.focused.some((c) => c.name === 'java-focused-tests'), 'Maven code should include focused tests');

  // --- Gradle config: build.gradle only should not generate focused tests ---
  const gradleStack = {
    profile: 'java-first',
    packageManager: 'gradle',
    java: { enabled: true, buildTool: 'gradle', buildCommand: 'gradle', linters: [] },
  };
  const gradleConfig = generateCommands(gradleStack, 'config', ['build.gradle']);
  assert(gradleConfig.smoke.some((c) => c.name === 'java-compile-check'), 'Gradle config should include compile check');
  assert(!gradleConfig.focused.some((c) => c.name === 'java-focused-tests'), 'Gradle config should not include focused tests without .java files');

  // --- Gradle code: .java change should generate focused tests ---
  const gradleCode = generateCommands(gradleStack, 'code', ['src/App.java']);
  assert(gradleCode.focused.some((c) => c.name === 'java-focused-tests'), 'Gradle code should include focused tests');

  // --- Mixed repo: go.mod + Cargo.toml in splitTargetsByStack ---
  const mixedStack = {
    profile: 'mixed',
    go: { enabled: true, packageManager: 'go modules', testRunner: 'go test' },
    rust: { enabled: true, packageManager: 'cargo', testRunner: 'cargo test' },
  };
  const mixedConfig = generateCommands(mixedStack, 'config', ['go.mod', 'Cargo.toml']);
  assert(mixedConfig.smoke.some((c) => c.name === 'go-build'), 'Mixed config should include go-build');
  assert(mixedConfig.smoke.some((c) => c.name === 'rust-check'), 'Mixed config should include rust-check');

  console.log('w2t3-command-quality-test: ok');
}

main();
