#!/usr/bin/env node
// @semantic — Java 14+ syntax the javalang oracle could never read (L3-9 Java half)
//
// These shapes have NO parity oracle: javalang 0.13.0 (last release 2020) fails
// the whole file, which is exactly why today's Java data for such files is
// silent regex-quality output. scripts/parser-parity-java.js can only judge the
// Java-8 subset; everything below is locked here by hand-derived expectations.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { parseJavaAst } = require('../src/services/dep-graph/parsers/java-ast');
const { parseJava } = require('../src/services/dep-graph/parsers/java');

const FIXTURE = path.join(__dirname, 'fixtures/java-modern/Modern.java');

function fn(result, name) {
  const record = result.functionRecords.find((r) => r.name === name);
  assert(record, `expected functionRecord ${name}`);
  return record;
}

function kindOf(result, name) {
  const record = result.exportRecords.find((r) => r.name === name);
  assert(record, `expected exportRecord ${name}`);
  return record.kind;
}

async function testModernFileIsAstNotRegex() {
  const source = fs.readFileSync(FIXTURE, 'utf8');
  const parsed = await parseJava(source, path.dirname(FIXTURE));
  assert.strictEqual(
    parsed.parseMode,
    'ast',
    'record/sealed/text-block/switch-expression file must reach the AST path, not degrade to regex'
  );
}

async function testRecordAndSealedDeclarations() {
  const result = await parseJavaAst(fs.readFileSync(FIXTURE, 'utf8'), '.');
  assert(result, 'modern fixture must parse');

  assert.strictEqual(result.package, 'modern.demo');
  assert.strictEqual(kindOf(result, 'Point'), 'record', 'record declaration kind');
  assert.strictEqual(kindOf(result, 'Circle'), 'record');
  assert.strictEqual(kindOf(result, 'Square'), 'record');
  assert.strictEqual(kindOf(result, 'Shape'), 'interface', 'sealed interface is still an interface');
  assert.strictEqual(kindOf(result, 'ModernFeatures'), 'class');

  // Record bodies carry real public methods — they must be walked like a class.
  assert.deepStrictEqual(
    ['Point', 'sum', 'scaled'],
    result.exports.slice(0, 3),
    'record name then its public methods, in source order'
  );
  // A sealed interface's methods are implicitly public (interface rule applies).
  assert(result.exports.includes('area'), 'sealed interface method must be exported');
}

async function testSwitchExpressionArms() {
  const result = await parseJavaAst(fs.readFileSync(FIXTURE, 'utf8'), '.');

  // Arrow form: three `case ... ->` rules, each one arm. javalang saw none of
  // this — the file did not parse at all.
  const arrow = fn(result, 'switchExpressionArrow');
  assert.strictEqual(arrow.fingerprint.branchCount, 3, 'three switch rules -> three branches');
  assert.strictEqual(arrow.fingerprint.maxArms, 3);

  const yielded = fn(result, 'switchExpressionYield');
  assert.strictEqual(yielded.fingerprint.branchCount, 2, 'two switch rules with block bodies');
  assert.strictEqual(yielded.fingerprint.maxArms, 2);
}

async function testInstanceofPatternAndVar() {
  const result = await parseJavaAst(fs.readFileSync(FIXTURE, 'utf8'), '.');

  // `if (o instanceof String s && s.length() > 3)` — the if plus the && .
  const pattern = fn(result, 'instanceofPattern');
  assert.strictEqual(pattern.fingerprint.branchCount, 2);
  assert.strictEqual(pattern.fingerprint.returnCount, 2);
  assert.strictEqual(pattern.returnType, 'String');

  // `for (var item : items)` is an enhanced-for like any other.
  const varLocal = fn(result, 'varLocal');
  assert.strictEqual(varLocal.fingerprint.branchCount, 1);
  assert.strictEqual(varLocal.returnType, 'String');
}

async function testTextBlockDoesNotBreakTheFile() {
  const result = await parseJavaAst(fs.readFileSync(FIXTURE, 'utf8'), '.');
  const textBlock = fn(result, 'textBlock');
  assert.strictEqual(textBlock.returnType, 'String');
  assert.strictEqual(textBlock.fingerprint.returnCount, 1);
  // The `{`/`}` inside the text block must not be read as code.
  assert.strictEqual(textBlock.fingerprint.branchCount, 0);
}

async function testBrokenSourceFallsBackInsteadOfLying() {
  // The spawn oracle raised on invalid source and java.js used regex; the
  // hasError gate must keep that contract rather than emit a half-recovered
  // tree as if it were trustworthy AST data.
  const broken = 'class A { void f( { ### unterminated\n';
  assert.strictEqual(await parseJavaAst(broken, '.'), null, 'broken source must return null');
  const parsed = await parseJava(broken, '.');
  assert.strictEqual(parsed.parseMode, 'regex', 'broken source must degrade to regex, not empty AST');
}

async function main() {
  await testModernFileIsAstNotRegex();
  await testRecordAndSealedDeclarations();
  await testSwitchExpressionArms();
  await testInstanceofPatternAndVar();
  await testTextBlockDoesNotBreakTheFile();
  await testBrokenSourceFallsBackInsteadOfLying();
  console.log('test/java-modern-syntax-test.js ... PASS');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
