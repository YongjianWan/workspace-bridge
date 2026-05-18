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

  const mapRec = result.functionRecords.find((r) => r.name === 'Map');
  assert(mapRec, 'should have Map functionRecord');

  const updateRec = result.functionRecords.find((r) => r.name === 'Update');
  assert(updateRec, 'should have Update method functionRecord');
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
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
