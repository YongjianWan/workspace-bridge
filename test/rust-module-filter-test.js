#!/usr/bin/env node
const assert = require('assert');
const { generateCommands } = require('../src/utils/stack-detector');

function main() {
  // --- Workspace Rust with module filtering ---
  const workspaceStack = {
    profile: 'rust-first',
    packageManager: 'cargo',
    rust: {
      enabled: true,
      packageManager: 'cargo',
      testRunner: 'cargo test',
      workspaceMembers: [
        { dir: 'crates/app', name: 'app' },
        { dir: 'crates/lib', name: 'lib' },
      ],
    },
  };

  // Single crate + single module
  const singleModule = generateCommands(workspaceStack, 'code', ['crates/app/src/parser.rs']);
  const singleFocused = singleModule.focused.find((c) => c.name === 'rust-focused-tests');
  assert(singleFocused, 'Workspace Rust should have focused tests');
  assert(singleFocused.cmd.includes('-p app'), `Workspace focused should target crate: ${singleFocused.cmd}`);
  assert(singleFocused.cmd.includes('parser'), `Workspace focused should filter module: ${singleFocused.cmd}`);

  // Multiple crates + modules
  const multiModule = generateCommands(workspaceStack, 'code', ['crates/app/src/parser.rs', 'crates/lib/src/lexer.rs']);
  const multiFocused = multiModule.focused.find((c) => c.name === 'rust-focused-tests');
  assert(multiFocused.cmd.includes('-p app'), `Multi-module should include -p app: ${multiFocused.cmd}`);
  assert(multiFocused.cmd.includes('-p lib'), `Multi-module should include -p lib: ${multiFocused.cmd}`);
  assert(multiFocused.cmd.includes('parser'), `Multi-module should filter parser: ${multiFocused.cmd}`);
  assert(multiFocused.cmd.includes('lexer'), `Multi-module should filter lexer: ${multiFocused.cmd}`);

  // mod.rs should resolve to parent directory name
  const modRs = generateCommands(workspaceStack, 'code', ['crates/app/src/utils/mod.rs']);
  const modRsFocused = modRs.focused.find((c) => c.name === 'rust-focused-tests');
  assert(modRsFocused.cmd.includes('utils'), `mod.rs should resolve to module name: ${modRsFocused.cmd}`);
  assert(!modRsFocused.cmd.includes('mod'), `mod.rs should not include 'mod' in filter: ${modRsFocused.cmd}`);

  // lib.rs / main.rs should not add module filter
  const libRs = generateCommands(workspaceStack, 'code', ['crates/app/src/lib.rs']);
  const libRsFocused = libRs.focused.find((c) => c.name === 'rust-focused-tests');
  assert(libRsFocused, 'lib.rs should still generate focused tests');
  assert(!libRsFocused.cmd.includes(' lib'), `lib.rs should not add module filter: ${libRsFocused.cmd}`);

  // --- Non-workspace Rust with module filtering ---
  const nonWorkspaceStack = {
    profile: 'rust-first',
    packageManager: 'cargo',
    rust: { enabled: true, packageManager: 'cargo', testRunner: 'cargo test' },
  };
  const nonWs = generateCommands(nonWorkspaceStack, 'code', ['src/parser.rs']);
  const nonWsFocused = nonWs.focused.find((c) => c.name === 'rust-focused-tests');
  assert(nonWsFocused, 'Non-workspace Rust should have focused tests');
  assert(!nonWsFocused.cmd.includes('-p'), `Non-workspace should not use -p: ${nonWsFocused.cmd}`);
  assert(nonWsFocused.cmd.includes('parser'), `Non-workspace should filter module: ${nonWsFocused.cmd}`);

  // --- Workspace Rust: direct tests via steps ---
  // When direct tests resolve to the same cmd as focused tests, addUniqueCommand dedupes.
  const directSteps = [{ name: 'run-direct-tests', targets: ['crates/app/src/parser.rs'] }];
  const directResult = generateCommands(workspaceStack, 'code', ['crates/app/src/parser.rs'], directSteps);
  const appTestCmds = directResult.focused.filter((c) => c.cmd && c.cmd.includes('-p app') && c.cmd.includes('parser'));
  assert.strictEqual(appTestCmds.length, 1, 'Should dedupe identical focused/direct test commands');
  assert(appTestCmds[0].cmd.includes('-p app'), `Direct test should target crate: ${appTestCmds[0].cmd}`);
  assert(appTestCmds[0].cmd.includes('parser'), `Direct test should filter module: ${appTestCmds[0].cmd}`);

  console.log('rust-module-filter-test: ok');
}

main();
