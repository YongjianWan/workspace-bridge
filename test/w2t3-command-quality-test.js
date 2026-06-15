#!/usr/bin/env node
// @semantic
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

  // --- Go code: .go change should trigger focused tests ---
  const goCode = generateCommands(goStack, 'code', ['src/app.go']);
  assert(goCode.focused.some((c) => c.name === 'go-focused-tests'), 'Go code should include go-focused-tests');

  // --- Rust code: .rs change should trigger full tests (no focused yet) ---
  const rustCode = generateCommands(rustStack, 'code', ['src/lib.rs']);
  assert(rustCode.smoke.some((c) => c.name === 'rust-check'), 'Rust code should include rust-check');
  assert(rustCode.full.some((c) => c.name === 'rust-all-tests'), 'Rust code should include rust-all-tests');

  // --- Mixed repo: go.mod + Cargo.toml in splitTargetsByStack ---
  const mixedStack = {
    profile: 'mixed',
    go: { enabled: true, packageManager: 'go modules', testRunner: 'go test' },
    rust: { enabled: true, packageManager: 'cargo', testRunner: 'cargo test' },
  };
  const mixedConfig = generateCommands(mixedStack, 'config', ['go.mod', 'Cargo.toml']);
  assert(mixedConfig.smoke.some((c) => c.name === 'go-build'), 'Mixed config should include go-build');
  assert(mixedConfig.smoke.some((c) => c.name === 'rust-check'), 'Mixed config should include rust-check');

  // --- Mixed repo boundary: only Python files changed -> node smoke should be suppressed ---
  const nodePythonMixed = {
    profile: 'mixed',
    node: { enabled: true, packageManager: 'npm', testRunner: 'jest', linters: ['eslint'], typeChecker: 'tsc' },
    python: { enabled: true, testRunner: 'pytest', linters: ['ruff'] },
  };
  const onlyPython = generateCommands(nodePythonMixed, 'code', ['app.py']);
  assert(onlyPython.smoke.some((c) => c.name === 'python-lint'), 'Mixed py-only should keep python smoke');
  assert(!onlyPython.smoke.some((c) => c.name === 'node-lint'), 'Mixed py-only should suppress node smoke');
  assert(!onlyPython.smoke.some((c) => c.name === 'node-type-check'), 'Mixed py-only should suppress node type-check');
  assert(onlyPython.full.some((c) => c.name === 'node-all-tests'), 'Mixed py-only should keep node full (regression)');
  assert(onlyPython.full.some((c) => c.name === 'python-all-tests'), 'Mixed py-only should keep python full');

  // --- Mixed repo boundary: only Node files changed -> python smoke should be suppressed ---
  const onlyNode = generateCommands(nodePythonMixed, 'code', ['app.ts']);
  assert(onlyNode.smoke.some((c) => c.name === 'node-lint'), 'Mixed node-only should keep node smoke');
  assert(!onlyNode.smoke.some((c) => c.name === 'python-lint'), 'Mixed node-only should suppress python smoke');
  assert(onlyNode.full.some((c) => c.name === 'node-all-tests'), 'Mixed node-only should keep node full');
  assert(onlyNode.full.some((c) => c.name === 'python-all-tests'), 'Mixed node-only should keep python full (regression)');

  // --- Mixed repo boundary: both stacks changed -> all smoke retained ---
  const bothChanged = generateCommands(nodePythonMixed, 'code', ['app.ts', 'app.py']);
  assert(bothChanged.smoke.some((c) => c.name === 'node-lint'), 'Mixed both should keep node smoke');
  assert(bothChanged.smoke.some((c) => c.name === 'python-lint'), 'Mixed both should keep python smoke');

  // --- Node custom runner: should not generate meaningless 'npx custom <files>' focused tests ---
  const customNodeStack = {
    profile: 'node-first',
    node: { enabled: true, packageManager: 'npm', testRunner: 'custom', linters: [] },
  };
  const customNodeCode = generateCommands(customNodeStack, 'code', ['src/app.js']);
  assert(!customNodeCode.focused.some((c) => c.name === 'node-focused-tests'), 'Custom runner should not generate focused tests');
  assert(customNodeCode.full.some((c) => c.name === 'node-all-tests' && c.cmd === 'npm run test'), 'Custom runner should still generate full test command');

  // --- Node jest runner: should generate focused tests for .js files ---
  const jestNodeStack = {
    profile: 'node-first',
    node: { enabled: true, packageManager: 'npm', testRunner: 'jest', linters: [] },
  };
  const jestNodeCode = generateCommands(jestNodeStack, 'code', ['src/app.js']);
  assert(jestNodeCode.focused.some((c) => c.name === 'node-focused-tests' && c.cmd.includes('jest')), 'Jest runner should generate focused tests');
}

main();
