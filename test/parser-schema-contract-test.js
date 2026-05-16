#!/usr/bin/env node
const assert = require('assert');
const {
  parsePython,
  parseJavaScript,
  parseJava,
  parseKotlin,
  parseGo,
  parseRust,
  parseVue,
  parseCpp,
  parseSvelte,
} = require('../src/services/dep-graph/parsers');

const EXPECTED_TOP_KEYS = ['exportRecords', 'exports', 'functionRecords', 'importRecords', 'imports', 'parseMode'];
const OPTIONAL_TOP_KEYS = ['package'];

function assertTopLevelSchema(result, label) {
  const keys = Object.keys(result).sort();
  const allowed = [...EXPECTED_TOP_KEYS, ...OPTIONAL_TOP_KEYS].sort();
  const extra = keys.filter((k) => !allowed.includes(k));
  const missing = EXPECTED_TOP_KEYS.filter((k) => !keys.includes(k));
  assert.deepStrictEqual(missing, [], `${label}: missing top-level keys`);
  assert.deepStrictEqual(extra, [], `${label}: unexpected extra top-level keys`);

  assert(Array.isArray(result.imports), `${label}: imports should be array`);
  assert(result.imports.every((v) => typeof v === 'string'), `${label}: imports should be string[]`);

  assert(Array.isArray(result.exports), `${label}: exports should be array`);
  assert(result.exports.every((v) => typeof v === 'string'), `${label}: exports should be string[]`);

  assert(Array.isArray(result.importRecords), `${label}: importRecords should be array`);
  assert(Array.isArray(result.exportRecords), `${label}: exportRecords should be array`);
  assert(Array.isArray(result.functionRecords), `${label}: functionRecords should be array`);
  assert(result.parseMode === 'ast' || result.parseMode === 'regex', `${label}: parseMode should be ast or regex`);
}

function assertImportRecord(record, label) {
  assert(typeof record.source === 'string', `${label}: importRecord.source should be string`);
  assert(Array.isArray(record.imported), `${label}: importRecord.imported should be array`);
  assert(typeof record.usesAllExports === 'boolean', `${label}: importRecord.usesAllExports should be boolean`);
}

function assertExportRecord(record, label) {
  assert(typeof record.name === 'string', `${label}: exportRecord.name should be string`);
  assert(typeof record.kind === 'string', `${label}: exportRecord.kind should be string`);
  if (record.lineStart !== undefined) {
    assert(Number.isFinite(record.lineStart), `${label}: exportRecord.lineStart should be finite number`);
  }
  if (record.lineEnd !== undefined) {
    assert(Number.isFinite(record.lineEnd), `${label}: exportRecord.lineEnd should be finite number`);
  }
  if (record.fingerprint !== undefined) {
    assert(record.fingerprint && typeof record.fingerprint === 'object', `${label}: exportRecord.fingerprint should be object`);
  }
}

function assertFunctionRecord(record, label) {
  assert(typeof record.name === 'string', `${label}: functionRecord.name should be string`);
  assert(typeof record.kind === 'string', `${label}: functionRecord.kind should be string`);
  if (record.lineStart !== undefined) {
    assert(Number.isFinite(record.lineStart), `${label}: functionRecord.lineStart should be finite number`);
  }
  if (record.lineEnd !== undefined) {
    assert(Number.isFinite(record.lineEnd), `${label}: functionRecord.lineEnd should be finite number`);
  }
  if (record.fingerprint !== undefined) {
    assert(record.fingerprint && typeof record.fingerprint === 'object', `${label}: functionRecord.fingerprint should be object`);
  }
}

function assertAllRecords(result, label) {
  for (const rec of result.importRecords) assertImportRecord(rec, label);
  for (const rec of result.exportRecords) assertExportRecord(rec, label);
  for (const rec of result.functionRecords) assertFunctionRecord(rec, label);
}

// ---------- Parser inputs (minimal representative snippets) ----------

const JS_SOURCE = `
import { foo } from './foo';
export const bar = 1;
export function baz() {}
`;

const PYTHON_SOURCE = `
import os
from collections import OrderedDict

class MyClass:
    pass

def my_func():
    pass
`;

const JAVA_SOURCE = `
package com.example;
import java.util.List;

public class Hello {
    public void world() {}
}
`;

const KOTLIN_SOURCE = `
package com.example
import kotlin.collections.List

class Hello {
    fun world() {}
}
`;

const GO_SOURCE = `
package main
import "fmt"

func Hello() {}

type MyStruct struct {}
`;

const RUST_SOURCE = `
use std::io::{self, Read};

pub fn hello() {}

pub struct Point;
`;

const VUE_SOURCE = `
<template><div>{{ msg }}</div></template>
<script setup>
import { ref } from 'vue';
export const msg = ref('hi');
</script>
`;

const CPP_SOURCE = `
#include <stdio.h>
#include "local.h"

int main() { return 0; }

void helper() {}
`;

const SVELTE_SOURCE = `
<script>
import { onMount } from 'svelte';
export let count = 0;
function inc() { count += 1; }
</script>
<button on:click={inc}>{count}</button>
`;

// ---------- Tests ----------

async function testJavaScriptSchema() {
  const result = parseJavaScript(JS_SOURCE, 'test.js');
  assertTopLevelSchema(result, 'parseJavaScript');
  assertAllRecords(result, 'parseJavaScript');
  assert(result.importRecords.some((r) => r.source === './foo'), 'parseJavaScript: should have ./foo importRecord');
  assert(result.exportRecords.some((r) => r.name === 'bar'), 'parseJavaScript: should have bar exportRecord');
}

async function testPythonSchema() {
  const result = await parsePython(PYTHON_SOURCE);
  assertTopLevelSchema(result, 'parsePython');
  assertAllRecords(result, 'parsePython');
  assert(result.importRecords.some((r) => r.source === 'os'), 'parsePython: should have os importRecord');
  assert(result.exportRecords.some((r) => r.name === 'MyClass'), 'parsePython: should have MyClass exportRecord');
}

async function testJavaSchema() {
  const result = await parseJava(JAVA_SOURCE);
  assertTopLevelSchema(result, 'parseJava');
  assertAllRecords(result, 'parseJava');
  assert(result.importRecords.some((r) => r.source === 'java.util.List'), 'parseJava: should have java.util.List importRecord');
  assert(result.exportRecords.some((r) => r.name === 'Hello'), 'parseJava: should have Hello exportRecord');
}

async function testKotlinSchema() {
  const result = await parseKotlin(KOTLIN_SOURCE);
  assertTopLevelSchema(result, 'parseKotlin');
  assertAllRecords(result, 'parseKotlin');
  assert(result.importRecords.some((r) => r.source === 'kotlin.collections.List'), 'parseKotlin: should have List importRecord');
  assert(result.exportRecords.some((r) => r.name === 'Hello'), 'parseKotlin: should have Hello exportRecord');
}

async function testGoSchema() {
  const result = await parseGo(GO_SOURCE);
  assertTopLevelSchema(result, 'parseGo');
  assertAllRecords(result, 'parseGo');
  assert(result.importRecords.some((r) => r.source === 'fmt'), 'parseGo: should have fmt importRecord');
  assert(result.exportRecords.some((r) => r.name === 'Hello'), 'parseGo: should have Hello exportRecord');
}

async function testRustSchema() {
  const result = await parseRust(RUST_SOURCE);
  assertTopLevelSchema(result, 'parseRust');
  assertAllRecords(result, 'parseRust');
  assert(result.importRecords.some((r) => r.source === 'std::io'), 'parseRust: should have std::io importRecord');
  assert(result.exportRecords.some((r) => r.name === 'hello'), 'parseRust: should have hello exportRecord');
}

async function testVueSchema() {
  const result = await parseVue(VUE_SOURCE);
  assertTopLevelSchema(result, 'parseVue');
  assertAllRecords(result, 'parseVue');
  assert(result.importRecords.some((r) => r.source === 'vue'), 'parseVue: should have vue importRecord');
  assert(result.exportRecords.some((r) => r.name === 'msg'), 'parseVue: should have msg exportRecord');
}

async function testCppSchema() {
  const result = await parseCpp(CPP_SOURCE, 'test.c');
  assertTopLevelSchema(result, 'parseCpp');
  assertAllRecords(result, 'parseCpp');
  assert(result.importRecords.some((r) => r.source === 'stdio.h'), 'parseCpp: should have stdio.h importRecord');
  assert(result.exportRecords.some((r) => r.name === 'main'), 'parseCpp: should have main exportRecord');
}

async function testSvelteSchema() {
  const result = parseSvelte(SVELTE_SOURCE, 'App.svelte');
  assertTopLevelSchema(result, 'parseSvelte');
  assertAllRecords(result, 'parseSvelte');
  assert(result.importRecords.some((r) => r.source === 'svelte'), 'parseSvelte: should have svelte importRecord');
  assert(result.exportRecords.some((r) => r.name === 'count'), 'parseSvelte: should have count exportRecord');
}

async function main() {
  await testJavaScriptSchema();
  await testPythonSchema();
  await testJavaSchema();
  await testKotlinSchema();
  await testGoSchema();
  await testRustSchema();
  await testVueSchema();
  await testCppSchema();
  await testSvelteSchema();
  console.log('parser-schema-contract-test: OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
