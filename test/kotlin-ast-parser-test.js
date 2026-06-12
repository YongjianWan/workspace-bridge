const assert = require('assert');
const { parseKotlin } = require('../src/services/dep-graph/parsers/kotlin-ast');
const { checkFileRules } = require('../src/services/dep-graph/ast-rules');

const KOTLIN_SOURCE = `
package com.example

import java.io.File
import java.util.*
import kotlinx.coroutines.delay

class MyClass {}

interface MyInterface {}

object MyObject {}

enum class MyEnum { A, B }

data class MyData(val x: Int)

fun topLevelFun() {}

const val MY_CONST = 1

val myProperty = "hello"

typealias MyAlias = String

private class PrivateClass {}

internal fun internalFun() {}

protected val protectedProp = 1

@Transactional
fun batchUpdateUsers() {}

fun batchInsertUsers() {}

fun batchReturnInt(): Int = 1
`;

async function testKotlinAstSchema() {
  const result = await parseKotlin(KOTLIN_SOURCE);

  assert.strictEqual(result.parseMode, 'ast', 'Should use AST mode');

  // imports
  assert(result.imports.includes('java.io.File'), 'Should have java.io.File import');
  assert(result.imports.includes('java.util.*'), 'Should have java.util.* wildcard import');
  assert(result.imports.includes('kotlinx.coroutines.delay'), 'Should have kotlinx.coroutines.delay import');

  // importRecords
  const fileImport = result.importRecords.find((r) => r.source === 'java.io.File');
  assert(fileImport, 'Should have java.io.File importRecord');
  assert.strictEqual(fileImport.usesAllExports, false);
  assert.deepStrictEqual(fileImport.imported, ['File'], 'Should extract imported class name');

  const wildcardImport = result.importRecords.find((r) => r.source === 'java.util');
  assert(wildcardImport, 'Should have java.util wildcard importRecord');
  assert.strictEqual(wildcardImport.usesAllExports, true);
  assert.deepStrictEqual(wildcardImport.imported, [], 'Wildcard import should have empty imported');

  const delayImport = result.importRecords.find((r) => r.source === 'kotlinx.coroutines.delay');
  assert(delayImport, 'Should have kotlinx.coroutines.delay importRecord');
  assert.deepStrictEqual(delayImport.imported, ['delay'], 'Should extract imported function name');

  // exports
  assert(result.exports.includes('MyClass'), 'Should export MyClass');
  assert(result.exports.includes('MyInterface'), 'Should export MyInterface');
  assert(result.exports.includes('MyObject'), 'Should export MyObject');
  assert(result.exports.includes('MyEnum'), 'Should export MyEnum');
  assert(result.exports.includes('MyData'), 'Should export MyData');
  assert(result.exports.includes('topLevelFun'), 'Should export topLevelFun');
  assert(result.exports.includes('MY_CONST'), 'Should export MY_CONST');
  assert(result.exports.includes('myProperty'), 'Should export myProperty');
  assert(result.exports.includes('MyAlias'), 'Should export MyAlias');

  // not exported
  assert(!result.exports.includes('PrivateClass'), 'Should not export private class');
  assert(!result.exports.includes('internalFun'), 'Should not export internal function');
  assert(!result.exports.includes('protectedProp'), 'Should not export protected property');

  // export record kinds
  const classRec = result.exportRecords.find((r) => r.name === 'MyClass');
  assert.strictEqual(classRec.kind, 'class');
  assert(typeof classRec.lineStart === 'number', 'MyClass should have lineStart');

  const interfaceRec = result.exportRecords.find((r) => r.name === 'MyInterface');
  assert.strictEqual(interfaceRec.kind, 'interface');

  const objectRec = result.exportRecords.find((r) => r.name === 'MyObject');
  assert.strictEqual(objectRec.kind, 'object');

  const enumRec = result.exportRecords.find((r) => r.name === 'MyEnum');
  assert.strictEqual(enumRec.kind, 'enum');

  const dataRec = result.exportRecords.find((r) => r.name === 'MyData');
  assert.strictEqual(dataRec.kind, 'data_class');

  const funcRec = result.exportRecords.find((r) => r.name === 'topLevelFun');
  assert.strictEqual(funcRec.kind, 'function');

  const constRec = result.exportRecords.find((r) => r.name === 'MY_CONST');
  assert.strictEqual(constRec.kind, 'const');

  const propRec = result.exportRecords.find((r) => r.name === 'myProperty');
  assert.strictEqual(propRec.kind, 'property');

  const aliasRec = result.exportRecords.find((r) => r.name === 'MyAlias');
  assert.strictEqual(aliasRec.kind, 'type');

  // functionRecords
  assert(result.functionRecords.some((r) => r.name === 'topLevelFun'), 'Should have topLevelFun functionRecord');
  assert(!result.functionRecords.some((r) => r.name === 'internalFun'), 'Should not have internalFun functionRecord');

  const topLevelFnRec = result.functionRecords.find((r) => r.name === 'topLevelFun');
  assert.strictEqual(topLevelFnRec.kind, 'function');
  assert.strictEqual(topLevelFnRec.isExported, true);
  assert.deepStrictEqual(topLevelFnRec.decorators, []);
  assert.strictEqual(topLevelFnRec.returnType, null);

  const batchUpdateRec = result.functionRecords.find((r) => r.name === 'batchUpdateUsers');
  assert(batchUpdateRec, 'Should have batchUpdateUsers functionRecord');
  assert.strictEqual(batchUpdateRec.isExported, true);
  assert.deepStrictEqual(batchUpdateRec.decorators, ['Transactional']);
  assert.strictEqual(batchUpdateRec.returnType, null);

  const batchReturnRec = result.functionRecords.find((r) => r.name === 'batchReturnInt');
  assert(batchReturnRec, 'Should have batchReturnInt functionRecord');
  assert.deepStrictEqual(batchReturnRec.decorators, []);
  assert.strictEqual(batchReturnRec.returnType, 'Int');

  // AST rule integration: batch-no-transactional should fire on Kotlin functions
  const findings = checkFileRules('MyService.kt', {
    originalPath: 'src/main/kotlin/com/example/MyService.kt',
    functionRecords: result.functionRecords,
  });
  const batchInsertFinding = findings.find((f) => f.symbol === 'batchInsertUsers');
  assert(batchInsertFinding, 'batchInsertUsers should trigger batch-no-transactional');
  assert.strictEqual(batchInsertFinding.severity, 'medium');
  assert.ok(batchInsertFinding.message.includes('lacks @Transactional'));
  assert(!findings.some((f) => f.symbol === 'batchUpdateUsers'), 'batchUpdateUsers has @Transactional, should not fire');
}

async function main() {
  await testKotlinAstSchema();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
