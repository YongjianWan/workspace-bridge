#!/usr/bin/env node
// @semantic
const assert = require('assert');
const { generateCommands } = require('../src/utils/stack-detector');

const CD_PREFIX = process.platform === 'win32' ? 'pushd' : 'cd';

function main() {
  // --- Single-module Go (no nested go.mod): existing behavior ---
  const singleModuleStack = {
    profile: 'go-first',
    packageManager: 'go modules',
    go: { enabled: true, packageManager: 'go modules', testRunner: 'go test' },
  };
  const single = generateCommands(singleModuleStack, 'code', ['pkg1/sub/a.go', 'pkg2/b.go']);
  const singleFocused = single.focused.find((c) => c.name === 'go-focused-tests');
  assert(singleFocused, 'Single-module Go should have focused tests');
  assert(singleFocused.cmd.includes('./pkg1/sub'), `Single-module should use package path: ${singleFocused.cmd}`);
  assert(singleFocused.cmd.includes('./pkg2'), `Single-module should use package path: ${singleFocused.cmd}`);
  assert(!singleFocused.cmd.includes(`${CD_PREFIX} `), `Single-module should not cd: ${singleFocused.cmd}`);

  // --- Multi-module Go (nested go.mod): per-module commands ---
  const multiModuleStack = {
    profile: 'go-first',
    packageManager: 'go modules',
    go: {
      enabled: true,
      packageManager: 'go modules',
      testRunner: 'go test',
      modules: [
        { dir: '.', root: true },
        { dir: 'backend', root: false },
        { dir: 'frontend', root: false },
      ],
    },
  };

  // File in backend module
  const backendOnly = generateCommands(multiModuleStack, 'code', ['backend/api/handlers/user.go']);
  const backendFocused = backendOnly.focused.filter((c) => c.name === 'go-focused-tests');
  assert.strictEqual(backendFocused.length, 1, 'Should generate one focused command for backend');
  assert(backendFocused[0].cmd.includes(`${CD_PREFIX} backend && `), `Backend should cd into module: ${backendFocused[0].cmd}`);
  assert(backendFocused[0].cmd.includes('go test ./...'), `Backend should run module tests: ${backendFocused[0].cmd}`);

  // Files in multiple modules
  const multi = generateCommands(multiModuleStack, 'code', ['backend/api/user.go', 'frontend/main.go']);
  const multiFocused = multi.focused.filter((c) => c.name === 'go-focused-tests');
  assert.strictEqual(multiFocused.length, 2, 'Should generate two focused commands for two modules');
  const backendCmd = multiFocused.find((c) => c.cmd.includes(`${CD_PREFIX} backend`));
  const frontendCmd = multiFocused.find((c) => c.cmd.includes(`${CD_PREFIX} frontend`));
  assert(backendCmd, `Should have backend command: ${multiFocused.map(c => c.cmd).join('; ')}`);
  assert(frontendCmd, `Should have frontend command: ${multiFocused.map(c => c.cmd).join('; ')}`);

  // File in root module
  const rootFile = generateCommands(multiModuleStack, 'code', ['cmd/main.go']);
  const rootFocused = rootFile.focused.filter((c) => c.name === 'go-focused-tests');
  assert.strictEqual(rootFocused.length, 1, 'Should generate one focused command for root module');
  assert(!rootFocused[0].cmd.includes(`${CD_PREFIX} `), `Root module should not cd: ${rootFocused[0].cmd}`);
  assert(rootFocused[0].cmd.includes('go test ./...'), `Root should run module tests: ${rootFocused[0].cmd}`);

  // --- Multi-module Go: direct tests via steps ---
  // When direct tests resolve to the same cmd as focused tests, addUniqueCommand dedupes.
  const directSteps = [{ name: 'run-direct-tests', targets: ['backend/api/user.go'] }];
  const directResult = generateCommands(multiModuleStack, 'code', ['backend/api/user.go'], directSteps);
  const backendTestCmds = directResult.focused.filter((c) => c.cmd && c.cmd.includes(`${CD_PREFIX} backend`));
  assert.strictEqual(backendTestCmds.length, 1, 'Should dedupe identical focused/direct test commands');
  assert(backendTestCmds[0].cmd.includes(`${CD_PREFIX} backend && `), `Direct backend should cd into module: ${backendTestCmds[0].cmd}`);
}

main();
