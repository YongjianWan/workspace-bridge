// @semantic
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { detectStack, generateCommands } = require('../src/utils/stack-detector');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

function testDetectRustWorkspaceMembers() {
  const tmpDir = makeTempDir('wb-rust-ws-');

  // Root workspace Cargo.toml
  fs.writeFileSync(path.join(tmpDir, 'Cargo.toml'), `
[workspace]
members = ["crate-a", "crate-b", "libs/shared"]
`);

  // Member crates
  fs.mkdirSync(path.join(tmpDir, 'crate-a', 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'crate-a', 'Cargo.toml'), `
[package]
name = "crate-a"
version = "0.1.0"
`);

  fs.mkdirSync(path.join(tmpDir, 'crate-b', 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'crate-b', 'Cargo.toml'), `
[package]
name = "crate-b"
version = "0.1.0"
`);

  fs.mkdirSync(path.join(tmpDir, 'libs', 'shared', 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'libs', 'shared', 'Cargo.toml'), `
[package]
name = "shared-lib"
version = "0.1.0"
`);

  const stack = detectStack(tmpDir);
  assert(stack.rust?.enabled, 'Rust stack should be detected');
  const members = stack.rust.workspaceMembers;
  assert(members, 'Workspace members should be detected');
  assert.strictEqual(members.length, 3, 'Should detect 3 workspace members');
  assert(members.some((m) => m.name === 'crate-a' && m.dir === 'crate-a'), 'Should include crate-a');
  assert(members.some((m) => m.name === 'crate-b' && m.dir === 'crate-b'), 'Should include crate-b');
  assert(members.some((m) => m.name === 'shared-lib' && m.dir === 'libs/shared'), 'Should include shared-lib');

  // Generate focused commands for files in different crates
  const commands = generateCommands(stack, 'code', ['crate-a/src/main.rs', 'libs/shared/src/lib.rs']);
  const focused = commands.focused.find((c) => c.name === 'rust-focused-tests');
  assert(focused, 'Should generate rust-focused-tests for workspace members');
  assert(focused.cmd.includes('-p crate-a'), 'Focused command should include -p crate-a');
  assert(focused.cmd.includes('-p shared-lib'), 'Focused command should include -p shared-lib');
  assert(!focused.cmd.includes('crate-b'), 'Focused command should not include unaffected crate-b');

  cleanupTempDir(tmpDir);
}

function testNonWorkspaceRust() {
  const tmpDir = makeTempDir('wb-rust-nws-');

  fs.writeFileSync(path.join(tmpDir, 'Cargo.toml'), `
[package]
name = "single-crate"
version = "0.1.0"
`);
  fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });

  const stack = detectStack(tmpDir);
  assert(stack.rust?.enabled, 'Rust stack should be detected');
  assert.strictEqual(stack.rust.workspaceMembers, null, 'Non-workspace should have null workspaceMembers');

  const commands = generateCommands(stack, 'code', ['src/main.rs']);
  // Single-crate projects fall back to `cargo test` (full crate) because module-level
  // filtering is not available without workspace members.
  const focused = commands.focused.find((c) => c.name === 'rust-focused-tests');
  assert(focused, 'Non-workspace single crate should generate rust-focused-tests as fallback');
  assert(focused.cmd.includes('cargo test'), 'Fallback focused command should run cargo test');

  cleanupTempDir(tmpDir);
}

function testIntegrationTestCommands() {
  const tmpDir = makeTempDir('wb-rust-integ-');

  fs.writeFileSync(path.join(tmpDir, 'Cargo.toml'), `
[package]
name = "single-crate"
version = "0.1.0"
`);
  fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'tests'), { recursive: true });

  const stack = detectStack(tmpDir);
  assert(stack.rust?.enabled, 'Rust stack should be detected');

  // Integration tests in tests/*.rs should be surfaced as --test <stem>.
  const commands = generateCommands(stack, 'code', ['src/graph/builder.rs', 'tests/smoke.rs', 'tests/edge_cases.rs']);
  const integration = commands.focused.find((c) => c.name === 'rust-focused-integration-tests');
  assert(integration, 'Should generate rust-focused-integration-tests for tests/*.rs files');
  assert(integration.cmd.includes('--test smoke'), 'Integration command should include --test smoke');
  assert(integration.cmd.includes('--test edge_cases'), 'Integration command should include --test edge_cases');

  const unit = commands.focused.find((c) => c.name === 'rust-focused-tests');
  assert(unit, 'Should generate rust-focused-tests for source modules');
  assert(unit.cmd.includes('graph::builder'), 'Unit command should include graph::builder module filter');

  cleanupTempDir(tmpDir);
}

function testIntegrationTestOnlyCommands() {
  const tmpDir = makeTempDir('wb-rust-integ-only-');

  fs.writeFileSync(path.join(tmpDir, 'Cargo.toml'), `
[package]
name = "single-crate"
version = "0.1.0"
`);
  fs.mkdirSync(path.join(tmpDir, 'tests'), { recursive: true });

  const stack = detectStack(tmpDir);
  assert(stack.rust?.enabled, 'Rust stack should be detected');

  // When only integration tests are affected, the integration command is still emitted.
  const commands = generateCommands(stack, 'code', ['tests/smoke.rs']);
  const integration = commands.focused.find((c) => c.name === 'rust-focused-integration-tests');
  assert(integration, 'Should generate rust-focused-integration-tests when only integration tests are affected');
  assert(integration.cmd.includes('--test smoke'), 'Integration-only command should include --test smoke');

  cleanupTempDir(tmpDir);
}

function main() {
  testDetectRustWorkspaceMembers();
  testNonWorkspaceRust();
  testIntegrationTestCommands();
  testIntegrationTestOnlyCommands();
  }

main();
