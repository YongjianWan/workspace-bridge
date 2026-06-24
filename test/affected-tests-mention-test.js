#!/usr/bin/env node
// @semantic
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { runCliInProcessRaw, makeTempDir, cleanupTempDir } = require('./test-helpers');

async function setupFixture() {
  const tmpDir = makeTempDir('wb-mention-');

  fs.mkdirSync(path.join(tmpDir, 'src', 'math'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'test', 'unit'), { recursive: true });

  // Source file with no imports
  fs.writeFileSync(
    path.join(tmpDir, 'src', 'math', 'calculator.js'),
    'function add(a, b) { return a + b; }\nmodule.exports = { add };\n',
    'utf8'
  );

  // Marker for workspace root detection
  fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"test-proj"}\n', 'utf8');

  return tmpDir;
}

async function runAffectedTests(tmpDir, file) {
  const result = await runCliInProcessRaw(['affected-tests', '--file', file, '--cwd', tmpDir, '--json']);
  assert.strictEqual(result.status, 0, `CLI failed: ${result.stderr}`);
  const data = JSON.parse(result.stdout.trim());
  assert(data.ok, 'should return ok');
  return data;
}

async function testMentionInCodeBody() {
  const tmpDir = await setupFixture();
  try {
    // Test file with DIFFERENT name but mentions source stem in body (code)
    fs.writeFileSync(
      path.join(tmpDir, 'test', 'unit', 'arith.test.js'),
      "describe('calculator', () => {\n  it('should add', () => {\n    call_tool_by_name('calculator');\n  });\n});\n",
      'utf8'
    );

    const data = await runAffectedTests(tmpDir, 'src/math/calculator.js');
    const mentionTest = data.affectedTests.find((t) => t.file.includes('arith.test.js'));
    assert(mentionTest, 'should find arith.test.js via mention detection');
    assert.strictEqual(mentionTest.source, 'mention', 'source should be mention');
  } finally {
    cleanupTempDir(tmpDir);
  }
}

async function testMentionOnlyInCommentsIsIgnored() {
  const tmpDir = await setupFixture();
  try {
    // Test file mentions source stem ONLY in comments — should not count as affected
    fs.writeFileSync(
      path.join(tmpDir, 'test', 'unit', 'arith.test.js'),
      "// calculator is tested elsewhere\ndescribe('other', () => {\n  it('passes', () => {});\n});\n",
      'utf8'
    );

    const data = await runAffectedTests(tmpDir, 'src/math/calculator.js');
    const mentionTest = data.affectedTests.find((t) => t.file.includes('arith.test.js'));
    assert.strictEqual(mentionTest, undefined, 'comment-only mention should not flag arith.test.js');
  } finally {
    cleanupTempDir(tmpDir);
  }
}

async function main() {
  await testMentionInCodeBody();
  await testMentionOnlyInCommentsIsIgnored();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
