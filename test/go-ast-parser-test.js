#!/usr/bin/env node
const assert = require('assert');
const { parseGo } = require('../src/services/dep-graph/parsers/go-ast');

const GO_SOURCE = `package example

import (
    "fmt"
    "strings"
)

const MaxSize = 100

var DefaultConfig = Config{Enabled: true}

type Config struct {
    Enabled bool
}

type Reader interface {
    Read(p []byte) (n int, err error)
}

func Process(input string) string {
    return strings.TrimSpace(input)
}

func (c *Config) Update() {
    c.Enabled = false
}

func Map[T any](s []T, fn func(T) T) []T {
    result := make([]T, len(s))
    for i, v := range s {
        result[i] = fn(v)
    }
    return result
}
`;

const GO_IMPORT_BLOCK = `package main

import (
    "fmt"
    "os"
    "strings"
)

func main() {
    fmt.Println(os.Args)
}
`;

const GO_UNEXPORTED = `package internal

const secret = 42
var hidden string
func helper() {}
type local struct{}
`;

const GO_NAMED_RETURNS = `package example

func Divide(a, b int) (quotient int, remainder int) {
    return a / b, a % b
}
`;

const GO_BRANCHES = `package example

func Classify(x int) string {
    if x == 1 {
        return "one"
    } else if x == 2 {
        return "two"
    } else if x == 3 {
        return "three"
    } else {
        return "other"
    }
}

func Switcher(x int) int {
    switch x {
    case 1:
        return 1
    case 2:
        return 2
    case 3:
        return 3
    default:
        return 0
    }
}

func Looper(items []int) int {
    sum := 0
    for _, v := range items {
        if v > 0 {
            sum += v
        }
    }
    return sum
}

func Logic(a, b bool) bool {
    return a && b || !a
}
`;

async function testBasicParsing() {
  const result = await parseGo(GO_SOURCE);
  assert(result.parseMode === 'ast' || result.parseMode === 'regex', 'parseMode should be ast or regex');
  assert(result.imports.includes('fmt'), 'should import fmt');
  assert(result.imports.includes('strings'), 'should import strings');
  assert(result.exports.includes('MaxSize'), 'should export MaxSize');
  assert(result.exports.includes('DefaultConfig'), 'should export DefaultConfig');
  assert(result.exports.includes('Config'), 'should export Config');
  assert(result.exports.includes('Reader'), 'should export Reader');
  assert(result.exports.includes('Process'), 'should export Process');
  assert(result.exports.includes('Update'), 'should export Update');
  assert(result.exports.includes('Map'), 'should export Map');
}

async function testImportRecords() {
  const result = await parseGo(GO_SOURCE);
  const fmtRec = result.importRecords.find((r) => r.source === 'fmt');
  assert(fmtRec, 'should have fmt importRecord');
  assert(fmtRec.usesAllExports === true, 'Go imports use all exports');
}

async function testExportRecords() {
  const result = await parseGo(GO_SOURCE);
  const funcRec = result.exportRecords.find((r) => r.name === 'Process');
  assert(funcRec, 'should have Process exportRecord');
  assert(funcRec.kind === 'function', 'Process should be kind function');
  assert(Number.isFinite(funcRec.lineStart), 'Process should have lineStart');
  assert(Number.isFinite(funcRec.lineEnd), 'Process should have lineEnd');

  const typeRec = result.exportRecords.find((r) => r.name === 'Config');
  assert(typeRec, 'should have Config exportRecord');
  assert(typeRec.kind === 'type', 'Config should be kind type');

  const constRec = result.exportRecords.find((r) => r.name === 'MaxSize');
  assert(constRec, 'should have MaxSize exportRecord');
  assert(constRec.kind === 'const', 'MaxSize should be kind const');

  const varRec = result.exportRecords.find((r) => r.name === 'DefaultConfig');
  assert(varRec, 'should have DefaultConfig exportRecord');
  assert(varRec.kind === 'variable', 'DefaultConfig should be kind variable');
}

async function testFunctionRecords() {
  const result = await parseGo(GO_SOURCE);
  const processRec = result.functionRecords.find((r) => r.name === 'Process');
  assert(processRec, 'should have Process functionRecord');
  assert(Number.isFinite(processRec.lineStart), 'Process functionRecord should have lineStart');
  assert(Number.isFinite(processRec.lineEnd), 'Process functionRecord should have lineEnd');
  assert(processRec.lineEnd > processRec.lineStart, 'Process lineEnd should be > lineStart');
  assert.strictEqual(processRec.isExported, true, 'Process should be exported');
  assert(Array.isArray(processRec.decorators), 'Process decorators should be an array');
  assert.deepStrictEqual(processRec.decorators, [], 'Go has no decorators');
  assert.strictEqual(processRec.returnType, 'string', 'Process should have return type string');

  const mapRec = result.functionRecords.find((r) => r.name === 'Map');
  assert(mapRec, 'should have Map functionRecord');
  assert.strictEqual(mapRec.isExported, true, 'Map should be exported');
  assert.strictEqual(mapRec.returnType, '[]T', 'Map should have return type []T');

  const updateRec = result.functionRecords.find((r) => r.name === 'Update');
  assert(updateRec, 'should have Update method functionRecord');
  assert.strictEqual(updateRec.isExported, true, 'Update method should be exported');
  assert.strictEqual(updateRec.returnType, undefined, 'Update should have no return type');
}

async function testMethodDeclaration() {
  const result = await parseGo(GO_SOURCE);
  assert(result.exports.includes('Update'), 'method Update should be exported');
  const rec = result.functionRecords.find((r) => r.name === 'Update');
  assert(rec, 'Update should be in functionRecords');
  assert(rec.kind === 'function', 'Update kind should be function');
}

async function testGenericsFunction() {
  const result = await parseGo(GO_SOURCE);
  assert(result.exports.includes('Map'), 'generic Map should be exported');
  const rec = result.functionRecords.find((r) => r.name === 'Map');
  assert(rec, 'Map should be in functionRecords');
}

async function testImportBlock() {
  const result = await parseGo(GO_IMPORT_BLOCK);
  assert(result.imports.length === 3, 'import block should yield 3 imports');
  assert(result.imports.includes('fmt'), 'should have fmt');
  assert(result.imports.includes('os'), 'should have os');
  assert(result.imports.includes('strings'), 'should have strings');
}

async function testUnexportedFiltered() {
  const result = await parseGo(GO_UNEXPORTED);
  assert(!result.exports.includes('secret'), 'secret should not be exported');
  assert(!result.exports.includes('hidden'), 'hidden should not be exported');
  assert(!result.exports.includes('helper'), 'helper should not be exported');
  assert(!result.exports.includes('local'), 'local should not be exported');
  assert(result.exports.length === 0, 'no exports expected for unexported file');
}

async function testLineEndGreaterThanLineStart() {
  const result = await parseGo(GO_SOURCE);
  for (const rec of result.functionRecords) {
    assert(Number.isFinite(rec.lineStart), `${rec.name} should have lineStart`);
    assert(Number.isFinite(rec.lineEnd), `${rec.name} should have lineEnd`);
    assert(rec.lineEnd >= rec.lineStart, `${rec.name} lineEnd should be >= lineStart`);
  }
}

async function testNamedReturns() {
  const result = await parseGo(GO_NAMED_RETURNS);
  const divideRec = result.functionRecords.find((r) => r.name === 'Divide');
  assert(divideRec, 'should have Divide functionRecord');
  assert.strictEqual(divideRec.returnType, '(quotient int, remainder int)', 'Divide should capture named return tuple');
}

async function testAllFunctionRecordsHaveParityFields() {
  const result = await parseGo(GO_SOURCE);
  for (const rec of result.functionRecords) {
    assert(typeof rec.isExported === 'boolean', `${rec.name} should have isExported boolean`);
    assert(Array.isArray(rec.decorators), `${rec.name} should have decorators array`);
    assert(rec.returnType === undefined || typeof rec.returnType === 'string', `${rec.name} returnType should be string or undefined`);
    assert(Number.isFinite(rec.branchCount), `${rec.name} should have finite branchCount`);
    assert(Number.isFinite(rec.maxArms), `${rec.name} should have finite maxArms`);
  }
}

async function testBranchCountAndMaxArms() {
  const result = await parseGo(GO_BRANCHES);

  const classifyRec = result.functionRecords.find((r) => r.name === 'Classify');
  assert(classifyRec, 'should have Classify functionRecord');
  assert.strictEqual(classifyRec.branchCount, 3, `Classify branchCount expected 3, got ${classifyRec.branchCount}`);
  assert.strictEqual(classifyRec.maxArms, 4, `Classify maxArms expected 4, got ${classifyRec.maxArms}`);

  const switcherRec = result.functionRecords.find((r) => r.name === 'Switcher');
  assert(switcherRec, 'should have Switcher functionRecord');
  assert.strictEqual(switcherRec.branchCount, 1, `Switcher branchCount expected 1, got ${switcherRec.branchCount}`);
  assert.strictEqual(switcherRec.maxArms, 4, `Switcher maxArms expected 4, got ${switcherRec.maxArms}`);

  const looperRec = result.functionRecords.find((r) => r.name === 'Looper');
  assert(looperRec, 'should have Looper functionRecord');
  assert.strictEqual(looperRec.branchCount, 2, `Looper branchCount expected 2, got ${looperRec.branchCount}`);
  assert.strictEqual(looperRec.maxArms, 1, `Looper maxArms expected 1, got ${looperRec.maxArms}`);

  const logicRec = result.functionRecords.find((r) => r.name === 'Logic');
  assert(logicRec, 'should have Logic functionRecord');
  assert.strictEqual(logicRec.branchCount, 2, `Logic branchCount expected 2, got ${logicRec.branchCount}`);
  assert.strictEqual(logicRec.maxArms, 0, `Logic maxArms expected 0, got ${logicRec.maxArms}`);
}

async function main() {
  await testBasicParsing();
  await testImportRecords();
  await testExportRecords();
  await testFunctionRecords();
  await testMethodDeclaration();
  await testGenericsFunction();
  await testImportBlock();
  await testUnexportedFiltered();
  await testLineEndGreaterThanLineStart();
  await testNamedReturns();
  await testAllFunctionRecordsHaveParityFields();
  await testBranchCountAndMaxArms();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
