#!/usr/bin/env node
// @contract
// @slow
const assert = require('assert');
const { parseJava } = require('../src/services/dep-graph/parsers');

// L3-9: the javalang availability gate is gone. It used to make four of the
// five tests below return without asserting anything on a machine with no
// python/javalang — i.e. the layer these tests guard was unguarded exactly
// where it was most likely to break. tree-sitter WASM ships as an npm
// dependency, so the AST path is now unconditionally exercised.

async function testJavaAST() {
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
  assert.strictEqual(result.parseMode, 'ast', 'tree-sitter AST is the only primary path');
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
  // Invalid Java syntax makes tree-sitter report hasError; verify regex fallback
  const result = await parseJava('this is not java');
  assert.strictEqual(result.parseMode, 'regex');
}

async function testJavaEnumAndAnnotationBodies() {
  // Two corners scripts/parser-parity-java.js cannot police on its own:
  //  - the enum/annotation "name only" guard in collectTypeMembers is redundant
  //    with tree-sitter's node shapes, so mutating it does not go red there;
  //  - `@interface` is the ONE intentional divergence from the javalang oracle
  //    (javalang's node class is AnnotationDeclaration, so java_ast_parser.py's
  //    AnnotationTypeDeclaration branch was dead and emitted nothing).
  const source = `
package com.example;
public enum Color {
  RED, GREEN;
  public void shout() {}
  public static final int COUNT = 2;
}
public @interface Marker {
  String value();
}
`;
  const result = await parseJava(source);
  assert.strictEqual(result.parseMode, 'ast');

  assert(result.exports.includes('Color'), 'enum type name is exported');
  assert(!result.exports.includes('shout'), 'enum body methods are NOT exported');
  assert(!result.exports.includes('COUNT'), 'enum body fields are NOT exported');
  assert(!result.exports.includes('RED'), 'enum constants are NOT exported');

  const marker = result.exportRecords.find((r) => r.name === 'Marker');
  assert(marker, '@interface must be exported (regex path always did)');
  assert.strictEqual(marker.kind, 'annotation');
  assert(!result.exports.includes('value'), 'annotation elements are NOT exported');
}

async function testJavaRecordIsExportedAsRecord() {
  // javalang could not parse this at all — the file used to degrade to regex.
  const result = await parseJava('public record Point(int x, int y) {}\n');
  assert.strictEqual(result.parseMode, 'ast', 'record must not degrade to regex');
  const point = result.exportRecords.find((r) => r.name === 'Point');
  assert(point, 'record type must be exported');
  assert.strictEqual(point.kind, 'record', 'both parse modes agree on kind record');
}

(async () => {
  await testJavaAST();
  await testJavaEnumAndAnnotationBodies();
  await testJavaRecordIsExportedAsRecord();
  await testJavaInterfaceMethods();
  await testJavaMethodAnnotations();
  await testJavaBranchCountAndMaxArms();
  await testJavaFallback();
})();
