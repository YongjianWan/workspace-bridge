#!/usr/bin/env node
// @semantic
const assert = require('assert');
const { renderCommandString, parseCommandString } = require('../src/utils/stack-detectors/commands');

function testBasicCommand() {
  assert.strictEqual(
    renderCommandString({ command: 'npm', args: ['run', 'test'] }),
    'npm run test',
    'basic command + args'
  );
}

function testCwdPrefix() {
  const isWin = process.platform === 'win32';
  const expected = isWin ? 'pushd backend && go test ./...' : 'cd backend && go test ./...';
  assert.strictEqual(
    renderCommandString({ command: 'go', args: ['test', './...'], cwd: 'backend' }),
    expected,
    'cwd prefix uses platform convention'
  );
}

function testWindowsCwdPrefix() {
  assert.strictEqual(
    renderCommandString({ command: 'go', args: ['test', './...'], cwd: 'backend' }, 'win32'),
    'pushd backend && go test ./...',
    'Windows uses pushd'
  );
}

function testLinuxCwdPrefix() {
  assert.strictEqual(
    renderCommandString({ command: 'go', args: ['test', './...'], cwd: 'backend' }, 'linux'),
    'cd backend && go test ./...',
    'Linux uses cd'
  );
}

function testShellFallback() {
  const shellCmd = 'echo "hello world" | grep hello';
  assert.strictEqual(
    renderCommandString({ command: 'echo', args: ['hello'], shell: shellCmd }),
    shellCmd,
    'shell field takes precedence'
  );
}

function testNullArgsFiltering() {
  assert.strictEqual(
    renderCommandString({ command: 'mvn', args: ['-pl', 'app', null, '-q'] }),
    'mvn -pl app -q',
    'null/undefined args filtered'
  );
}

function testEmptyExecutable() {
  assert.strictEqual(renderCommandString(null), '', 'null executable');
  assert.strictEqual(renderCommandString(undefined), '', 'undefined executable');
  assert.strictEqual(renderCommandString({}), '', 'empty object');
}

function testRoundTripWithParse() {
  const isWin = process.platform === 'win32';
  const original = isWin ? 'pushd app && go test ./...' : 'cd app && go test ./...';
  const parsed = parseCommandString(original);
  assert.strictEqual(parsed.cwd, 'app');
  assert.strictEqual(parsed.command, 'go');
  assert.deepStrictEqual(parsed.args, ['test', './...']);
  const rendered = renderCommandString(parsed);
  assert.strictEqual(rendered, original, 'parse then render round-trip');
}

function testRoundTripNoCwd() {
  const original = 'cargo test -p crate1';
  const parsed = parseCommandString(original);
  const rendered = renderCommandString(parsed);
  assert.strictEqual(rendered, original, 'round-trip without cwd');
}

function testNoArgs() {
  assert.strictEqual(
    renderCommandString({ command: 'pyright', args: [] }),
    'pyright',
    'empty args array'
  );
}

function testParsePushd() {
  const parsed = parseCommandString('pushd backend && go test ./...');
  assert.strictEqual(parsed.cwd, 'backend');
  assert.strictEqual(parsed.command, 'go');
  assert.deepStrictEqual(parsed.args, ['test', './...']);
}

function testParseSemicolon() {
  const parsed = parseCommandString('cd backend ; go test ./...');
  assert.strictEqual(parsed.cwd, 'backend');
  assert.strictEqual(parsed.command, 'go');
  assert.deepStrictEqual(parsed.args, ['test', './...']);
}

function testParsePushdSemicolon() {
  const parsed = parseCommandString('pushd backend ; go test ./...');
  assert.strictEqual(parsed.cwd, 'backend');
  assert.strictEqual(parsed.command, 'go');
  assert.deepStrictEqual(parsed.args, ['test', './...']);
}

function testParseCdPrefixDoesNotRequireShell() {
  const parsed = parseCommandString('cd backend && go test ./...');
  assert.strictEqual(parsed.cwd, 'backend');
  assert.strictEqual(parsed.command, 'go');
  assert.deepStrictEqual(parsed.args, ['test', './...']);
  assert.strictEqual(parsed.shell, null, 'plain cd prefix + single command should not require shell');
}

function testParseRealShellOpsRequireShell() {
  const parsed = parseCommandString('cat file.txt | grep x');
  assert.strictEqual(parsed.command, 'cat');
  assert.deepStrictEqual(parsed.args, ['file.txt', '|', 'grep', 'x']);
  assert.strictEqual(parsed.shell, 'cat file.txt | grep x', 'pipes require shell execution');
}

function main() {
  testBasicCommand();
  testCwdPrefix();
  testWindowsCwdPrefix();
  testLinuxCwdPrefix();
  testShellFallback();
  testNullArgsFiltering();
  testEmptyExecutable();
  testRoundTripWithParse();
  testRoundTripNoCwd();
  testNoArgs();
  testParsePushd();
  testParseSemicolon();
  testParsePushdSemicolon();
  testParseCdPrefixDoesNotRequireShell();
  testParseRealShellOpsRequireShell();
  console.log('test/render-command-string-test.js ... PASS');
}

main();
