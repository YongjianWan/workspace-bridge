#!/usr/bin/env node
// @slow
/**
 * CLI 多语言、非 ASCII 路径与 Heuristic 测试映射测试
 * Runs in isolated temporary workspaces concurrently.
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { runCliInProcess, runCliInProcessText, runInDir, makeTempDir, cleanupTempDir } = require('./test-helpers');

async function testPolyglotImpact() {
  const tempRoot = makeTempDir('wb-cli-polyglot-');
  const write = (rel, content) => {
    const full = path.join(tempRoot, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  };
  write('package.json', JSON.stringify({ name: 'polyglot-test', version: '1.0.0' }, null, 2));
  write('requirements.txt', 'fastapi\npytest\n');
  write('pytest.ini', '[pytest]\n');
  write('pom.xml', '<project><modelVersion>4.0.0</modelVersion><groupId>com.example</groupId><artifactId>polyglot</artifactId><version>1.0.0</version></project>');
  write('mvnw', '#!/bin/sh\necho mvnw\n');
  write('src/util.js', 'export function utilFn() { return 1; }\n');
  write('src/index.js', 'import { utilFn } from "./util";\nexport function run() { return utilFn(); }\n');
  write('api/util.py', 'def helper():\n    return 1\n');
  write('api/app.py', 'from .util import helper\n\ndef run():\n    return helper()\n');
  write('src/main/java/com/example/Util.java', 'package com.example;\npublic class Util { public static int value() { return 1; } }\n');
  write('src/main/java/com/example/App.java', 'package com.example;\nimport com.example.Util;\npublic class App { public int run() { return Util.value(); } }\n');
  write('src/test/java/com/example/AppTest.java', 'package com.example;\nimport com.example.App;\npublic class AppTest { public int run() { return new App().run(); } }\n');
  runInDir('git', ['init'], tempRoot);
  runInDir('git', ['config', 'user.email', 'test@example.com'], tempRoot);
  runInDir('git', ['config', 'user.name', 'Test User'], tempRoot);
  runInDir('git', ['add', '.'], tempRoot);
  runInDir('git', ['commit', '-m', 'init'], tempRoot);
  write('src/util.js', 'export function utilFn() { return 2; }\n');
  write('api/util.py', 'def helper():\n    return 2\n');
  write('src/main/java/com/example/Util.java', 'package com.example;\npublic class Util { public static int value() { return 2; } }\n');

  const polyDiff = await runCliInProcess(['audit-diff', '--cwd', tempRoot, '--json', '--quiet']);
  assert.strictEqual(polyDiff.ok, true);
  assert(Array.isArray(polyDiff.changedFiles));
  const byFile = new Map(polyDiff.changedFiles.map((entry) => [entry.file.replace(/\\/g, '/'), entry]));
  const jsEntry = byFile.get('src/util.js');
  const pyEntry = byFile.get('api/util.py');
  const javaEntry = byFile.get('src/main/java/com/example/Util.java');

  assert(jsEntry?.symbolImpact, 'js symbolImpact should exist');
  assert(pyEntry?.symbolImpact, 'python symbolImpact should exist');
  assert(javaEntry?.symbolImpact, 'java symbolImpact should exist');
  assert(Array.isArray(jsEntry.symbolImpact.symbolToDependents));
  assert(Array.isArray(jsEntry.symbolImpact.functionToDependents));
  assert(jsEntry.symbolImpact.changedFunctionImpact, 'changedFunctionImpact should exist');
  if (jsEntry.symbolImpact.changedFunctionImpact.mode !== 'function-symbol') {
    console.error('DIAGNOSTIC: changedFunctionImpact.mode =', jsEntry.symbolImpact.changedFunctionImpact.mode,
      'reason =', jsEntry.symbolImpact.changedFunctionImpact.reason,
      'actualParseMode =', jsEntry.symbolImpact.changedFunctionImpact.actualParseMode,
      'file =', jsEntry.file);
  }
  assert(jsEntry.symbolImpact.changedFunctionImpact.functionLevelAffectedTests, 'functionLevelAffectedTests should exist');
  assert(
    jsEntry.symbolImpact.changedFunctionImpact.functionLevelAffectedTests.affectedTestsCount >= 0,
    `functionLevelAffectedTests.affectedTestsCount should be >= 0, got ${jsEntry.symbolImpact.changedFunctionImpact.functionLevelAffectedTests.affectedTestsCount}`
  );
  assert(Array.isArray(jsEntry.changedLineRanges), 'changedLineRanges should exist');
  const jsSymbolRow = jsEntry.symbolImpact.symbolToDependents.find((item) => item.symbol === 'utilFn');
  if (!jsSymbolRow) {
    console.error('DIAGNOSTIC: symbolToDependents =', JSON.stringify(jsEntry.symbolImpact.symbolToDependents));
    console.error('DIAGNOSTIC: symbolImpact.mode =', jsEntry.symbolImpact.mode);
  }
  assert(jsSymbolRow, 'js symbol-to-dependent mapping should include utilFn');
  assert(jsSymbolRow.dependentsCount >= 1, 'utilFn should have at least one dependent');
  const jsFunctionRow = jsEntry.symbolImpact.functionToDependents.find((item) => item.function === 'utilFn');
  assert(jsFunctionRow, 'js function-level mapping should include utilFn');
  assert(jsFunctionRow.dependentsCount >= 1, 'utilFn function-level mapping should have at least one dependent');
  if (jsEntry.symbolImpact.changedFunctionImpact.mode === 'function-symbol') {
    assert(jsEntry.symbolImpact.changedFunctionImpact.changedFunctions.includes('utilFn'));
  }
  assert(polyDiff.validationAdvice.stack.java, 'java stack should exist in polyglot repo');
  assert.strictEqual(polyDiff.validationAdvice.stack.java.buildCommand, './mvnw');
  assert(jsEntry.impactCount >= 1);
  assert(pyEntry.impactCount >= 1);
  assert(javaEntry.impactCount >= 1);
  assert(javaEntry.affectedTestsCount >= 1);

  const polyCommandNames = [
    ...polyDiff.validationAdvice.commands.smoke.map((c) => c.name),
    ...polyDiff.validationAdvice.commands.focused.map((c) => c.name),
    ...polyDiff.validationAdvice.commands.full.map((c) => c.name),
  ];
  assert(polyCommandNames.includes('java-all-tests'));
  const javaAllTestCmd = polyDiff.validationAdvice.commands.full.find((c) => c.name === 'java-all-tests')?.cmd || '';
  assert(javaAllTestCmd.includes('./mvnw'), 'java commands should prefer project wrapper');

  cleanupTempDir(tempRoot);
}

async function testNonAsciiPaths() {
  const tempRoot = makeTempDir('wb-cli-cn-');
  const write = (rel, content) => {
    const full = path.join(tempRoot, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  };
  write('package.json', JSON.stringify({ name: 'cn-test', version: '1.0.0', main: 'src/index.js' }, null, 2));
  write('src/模块.js', 'export function 你好() { return 42; }\n');
  write('src/index.js', 'import { 你好 } from "./模块";\nexport function main() { return 你好(); }\n');

  const cnUnresolved = await runCliInProcess(['unresolved', '--cwd', tempRoot, '--json', '--quiet']);
  const cnImpact = await runCliInProcess(['impact', '--cwd', tempRoot, '--file', 'src/模块.js', '--json', '--quiet']);
  assert.strictEqual(cnUnresolved.unresolvedCount, 0);
  assert.strictEqual(cnImpact.impactCount, 1);

  cleanupTempDir(tempRoot);
}

async function testHeuristicTestMapping() {
  const tempRoot = makeTempDir('wb-cli-heuristic-');
  const write = (rel, content) => {
    const full = path.join(tempRoot, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  };
  write('package.json', JSON.stringify({ name: 'heuristic-test', version: '1.0.0' }, null, 2));
  write('src/order-service.js', 'export function calc() { return 1; }\n');
  write('test/order-service.test.js', 'describe("order", () => { it("ok", () => {}); });\n');

  const affected = await runCliInProcess(['affected-tests', '--cwd', tempRoot, '--file', 'src/order-service.js', '--json', '--quiet']);
  assert(affected.affectedTestsCount >= 1, 'heuristic mapping should find same-stem test file');

  cleanupTempDir(tempRoot);
}

async function testAffectedTestsChain() {
  const tempRoot = makeTempDir('wb-cli-affected-via-');
  const write = (rel, content) => {
    const full = path.join(tempRoot, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  };
  write('package.json', JSON.stringify({ name: 'via-test', version: '1.0.0' }, null, 2));
  write('src/lib.js', 'export function helper() { return 1; }\n');
  write('src/mid.js', 'import { helper } from "./lib.js";\nexport function mid() { return helper(); }\n');
  write('test/mid.test.js', 'import { mid } from "../src/mid.js";\ndescribe("mid", () => { it("works", () => {}); });\n');

  const text = await runCliInProcessText(['affected-tests', '--cwd', tempRoot, '--file', 'src/lib.js']);
  assert(text.includes('via'), `affected-tests human-readable should show via chain, got:\n${text}`);

  cleanupTempDir(tempRoot);
}

async function main() {
  await testPolyglotImpact();
  await testNonAsciiPaths();
  await testHeuristicTestMapping();
  await testAffectedTestsChain();
}

main();
