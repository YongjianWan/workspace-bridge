#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { runCliRaw, makeTempDir, cleanupTempDir } = require('./test-helpers');

async function main() {
  const tmpDir = makeTempDir('wb-mention-');

  fs.mkdirSync(path.join(tmpDir, 'src', 'math'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'test', 'unit'), { recursive: true });

  // Source file with no imports
  fs.writeFileSync(
    path.join(tmpDir, 'src', 'math', 'calculator.js'),
    'function add(a, b) { return a + b; }\nmodule.exports = { add };\n',
    'utf8'
  );

  // Test file with DIFFERENT name but mentions source stem in body
  fs.writeFileSync(
    path.join(tmpDir, 'test', 'unit', 'arith.test.js'),
    "describe('calculator', () => {\n  it('should add', () => {\n    call_tool_by_name('calculator');\n  });\n});\n",
    'utf8'
  );

  // Marker for workspace root detection
  fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"test-proj"}\n', 'utf8');

  const result = runCliRaw(['affected-tests', '--file', 'src/math/calculator.js', '--cwd', tmpDir, '--json']);
  assert.strictEqual(result.status, 0, `CLI failed: ${result.stderr}`);

  const data = JSON.parse(result.stdout.trim());
  assert(data.ok, 'should return ok');

  const mentionTest = data.affectedTests.find((t) => t.file.includes('arith.test.js'));
  assert(mentionTest, 'should find arith.test.js via mention detection');
  assert.strictEqual(mentionTest.source, 'mention', 'source should be mention');

  cleanupTempDir(tmpDir);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
