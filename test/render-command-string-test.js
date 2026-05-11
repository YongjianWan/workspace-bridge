#!/usr/bin/env node
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
  assert.strictEqual(
    renderCommandString({ command: 'go', args: ['test', './...'], cwd: 'backend' }),
    'cd backend && go test ./...',
    'cwd prefix'
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
  const original = 'cd app && go test ./...';
  const parsed = parseCommandString(original);
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

function main() {
  testBasicCommand();
  testCwdPrefix();
  testShellFallback();
  testNullArgsFiltering();
  testEmptyExecutable();
  testRoundTripWithParse();
  testRoundTripNoCwd();
  testNoArgs();
  console.log('render-command-string-test: all 8 passed');
}

main();
