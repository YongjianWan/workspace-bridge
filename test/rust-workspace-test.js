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
  assert(!commands.focused.some((c) => c.name === 'rust-focused-tests'), 'Non-workspace should not generate focused crate commands');

  cleanupTempDir(tmpDir);
}

function main() {
  testDetectRustWorkspaceMembers();
  testNonWorkspaceRust();
  }

main();
