#!/usr/bin/env node
// @slow
const assert = require('assert');
const { spawnSync } = require('child_process');
const { TIMEOUTS } = require('../src/config/constants');
const { parseJava } = require('../src/services/dep-graph/parsers');

function isJavalangAvailable() {
  const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
  const result = spawnSync(pythonCmd, ['-c', 'import javalang; print("ok")'], {
    encoding: 'utf8',
    timeout: TIMEOUTS.HEALTH_SHORT_TIMEOUT_MS,
  });
  return result.status === 0 && result.stdout.includes('ok');
}

const JAVALANG_AVAILABLE = isJavalangAvailable();

async function testJavaAST() {
  if (!JAVALANG_AVAILABLE) {
    return;
  }
  const source = `
package com.example;
import java.util.List;
import static org.junit.Assert.assertEquals;

public class Foo {
  public void bar() {}
  public int baz;
}
`;
  const result = await parseJava(source);
  assert.strictEqual(result.parseMode, 'ast', 'Should use AST when javalang available');
  assert.strictEqual(result.package, 'com.example', 'Should parse package declaration');
  assert(result.imports.includes('java.util.List'));
  assert(result.imports.includes('org.junit.Assert'));
  assert(!result.imports.some(i => i.startsWith('static ')), 'static prefix should not appear in imports');
  assert(result.exports.includes('Foo'));
  assert(result.exports.includes('bar'));
  assert(result.exports.includes('baz'));

  const staticRecord = result.importRecords.find(r => r.isStatic);
  assert(staticRecord, 'Should have isStatic record');
  assert.strictEqual(staticRecord.source, 'org.junit.Assert', 'static import source should be package path');
  assert.deepStrictEqual(staticRecord.imported, ['assertEquals']);
}

async function testJavaInterfaceMethods() {
  if (!JAVALANG_AVAILABLE) {
    return;
  }
  const source = `
package com.example;
public interface Calculator {
  int add(int a, int b);
  default int subtract(int a, int b) { return a - b; }
}
`;
  const result = await parseJava(source);
  assert.strictEqual(result.parseMode, 'ast');
  assert(result.exports.includes('Calculator'));
  assert(result.exports.includes('add'));
  assert(result.exports.includes('subtract'));
}

async function testJavaFallback() {
  // Invalid Java syntax triggers javalang exception; verify regex fallback
  const result = await parseJava('this is not java');
  assert.strictEqual(result.parseMode, 'regex');
}

(async () => {
  await testJavaAST();
  await testJavaInterfaceMethods();
  await testJavaFallback();
})();
