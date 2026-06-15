#!/usr/bin/env node
// @contract
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

async function testJavaMethodAnnotations() {
  if (!JAVALANG_AVAILABLE) {
    return;
  }
  const source = `
package com.example;
public class Service {
  @Transactional
  public void batchUpdate() {}

  @org.springframework.transaction.annotation.Transactional
  public void batchDelete() {}

  public void batchRun() {}
}
`;
  const result = await parseJava(source);
  assert.strictEqual(result.parseMode, 'ast');

  const batchUpdate = result.functionRecords.find((r) => r.name === 'batchUpdate');
  const batchDelete = result.functionRecords.find((r) => r.name === 'batchDelete');
  const batchRun = result.functionRecords.find((r) => r.name === 'batchRun');

  assert(batchUpdate, 'Should have batchUpdate functionRecord');
  assert(batchDelete, 'Should have batchDelete functionRecord');
  assert(batchRun, 'Should have batchRun functionRecord');

  assert(Array.isArray(batchUpdate.decorators), 'batchUpdate should have decorators array');
  assert(batchUpdate.decorators.some((d) => /Transactional/i.test(d)), 'batchUpdate should have Transactional decorator');
  assert(batchDelete.decorators.some((d) => /Transactional/i.test(d)), 'batchDelete should have Transactional decorator');
  assert(
    !batchRun.decorators || batchRun.decorators.length === 0 || !batchRun.decorators.some((d) => /Transactional/i.test(d)),
    'batchRun should not have Transactional decorator'
  );

  // Existing fields must remain intact.
  for (const record of result.functionRecords) {
    assert.strictEqual(typeof record.name, 'string');
    assert.strictEqual(record.kind, 'function');
    assert(typeof record.lineStart === 'number');
    assert(typeof record.lineEnd === 'number');
    assert(record.fingerprint && typeof record.fingerprint.paramCount === 'number');
  }
}

async function testJavaBranchCountAndMaxArms() {
  if (!JAVALANG_AVAILABLE) {
    return;
  }
  const source = `
package com.example;
public class Logic {
  public void decide(int x) {
    if (x > 0) {
      System.out.println("positive");
    } else if (x < 0) {
      System.out.println("negative");
    } else {
      System.out.println("zero");
    }
  }

  public int pick(int n) {
    switch (n) {
      case 1: return 1;
      case 2: return 2;
      default: return 0;
    }
  }

  public void plain() {}
}
`;
  const result = await parseJava(source);
  assert.strictEqual(result.parseMode, 'ast');

  const decide = result.functionRecords.find((r) => r.name === 'decide');
  const pick = result.functionRecords.find((r) => r.name === 'pick');
  const plain = result.functionRecords.find((r) => r.name === 'plain');

  assert(decide, 'Should have decide functionRecord');
  assert(pick, 'Should have pick functionRecord');
  assert(plain, 'Should have plain functionRecord');

  assert.strictEqual(typeof decide.branchCount, 'number', 'decide.branchCount should be a number');
  assert.strictEqual(typeof decide.maxArms, 'number', 'decide.maxArms should be a number');
  assert(decide.branchCount >= 2, `decide should have at least 2 branches, got ${decide.branchCount}`);
  assert.strictEqual(decide.maxArms, 3, `decide should have 3 if/else arms, got ${decide.maxArms}`);

  assert.strictEqual(typeof pick.branchCount, 'number', 'pick.branchCount should be a number');
  assert.strictEqual(typeof pick.maxArms, 'number', 'pick.maxArms should be a number');
  assert(pick.branchCount >= 3, `pick should have at least 3 switch branches, got ${pick.branchCount}`);
  assert.strictEqual(pick.maxArms, 3, `pick should have 3 switch arms, got ${pick.maxArms}`);

  assert.strictEqual(plain.branchCount, 0, 'plain should have 0 branches');
  assert.strictEqual(plain.maxArms, 0, 'plain should have 0 maxArms');

  // Top-level values should mirror the values kept inside the fingerprint.
  assert.strictEqual(decide.branchCount, decide.fingerprint.branchCount);
  assert.strictEqual(decide.maxArms, decide.fingerprint.maxArms);
}

async function testJavaFallback() {
  // Invalid Java syntax triggers javalang exception; verify regex fallback
  const result = await parseJava('this is not java');
  assert.strictEqual(result.parseMode, 'regex');
}

(async () => {
  await testJavaAST();
  await testJavaInterfaceMethods();
  await testJavaMethodAnnotations();
  await testJavaBranchCountAndMaxArms();
  await testJavaFallback();
})();
