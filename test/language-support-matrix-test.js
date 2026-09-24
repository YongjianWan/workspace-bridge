// @semantic
const assert = require('assert');
const path = require('path');
const { createMockDepGraph } = require('./test-helpers');

function testBuildLanguageSupportMatrix() {
  const root = '/repo';
  const depGraph = createMockDepGraph({
    schema: {
      [path.join(root, 'src', 'app.js')]: { imports: [], exports: [], importRecords: [], exportRecords: [], parseMode: 'ast' },
      [path.join(root, 'src', 'util.ts')]: { imports: [], exports: [], importRecords: [], exportRecords: [], parseMode: 'ast' },
      [path.join(root, 'lib', 'helper.py')]: { imports: [], exports: [], importRecords: [], exportRecords: [], parseMode: 'ast' },
      [path.join(root, 'lib', 'legacy.py')]: { imports: [], exports: [], importRecords: [], exportRecords: [], parseMode: 'regex' },
      [path.join(root, 'src', 'main.go')]: { imports: [], exports: [], importRecords: [], exportRecords: [], parseMode: 'regex' },
      [path.join(root, 'src', 'core.c')]: { imports: [], exports: [], importRecords: [], exportRecords: [], parseMode: 'ast' },
      [path.join(root, 'include', 'core.h')]: { imports: [], exports: [], importRecords: [], exportRecords: [], parseMode: 'ast' },
    }
  });

  const { buildLanguageSupportMatrix } = require('../src/tools/overview-assembler');
  const matrix = buildLanguageSupportMatrix(depGraph);

  assert.strictEqual(matrix.javascript.level, 'ast', 'javascript should be ast');
  assert.strictEqual(matrix.javascript.confidence, 'high', 'javascript should have high confidence (2/2 ast)');
  assert.strictEqual(matrix.python.level, 'ast', 'python should be ast (1/2 ast, ratio >= 0.5)');
  assert.strictEqual(matrix.python.confidence, 'medium', 'python should have medium confidence');
  assert.strictEqual(matrix.go.level, 'regex', 'go should be regex (all files are regex-parsed)');
  assert.strictEqual(matrix.go.confidence, 'low', 'go should have low confidence (0 ast)');
  assert.strictEqual(matrix.cpp.level, 'ast', 'cpp should be ast');
  assert.strictEqual(matrix.cpp.confidence, 'high', 'cpp should have high confidence');
  assert.strictEqual(matrix.cpp.files, 2, 'cpp should have 2 files');
  assert.strictEqual(matrix.java, undefined, 'java should not be present');
}

function testBuildLanguageSupportMatrixEmpty() {
  const depGraph = createMockDepGraph({ schema: {} });
  const { buildLanguageSupportMatrix } = require('../src/tools/overview-assembler');
  const matrix = buildLanguageSupportMatrix(depGraph);
  assert.deepStrictEqual(matrix, {}, 'empty graph should yield empty matrix');
}

function testPureCWorkspaceDetection() {
  const fs = require('fs');
  const os = require('os');
  const { detectWorkspace } = require('../src/utils/path');
  const { detectStack } = require('../src/utils/stack-detectors/detect');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-pure-c-test-'));
  try {
    fs.mkdirSync(path.join(tmpDir, 'src'));
    fs.writeFileSync(path.join(tmpDir, 'src', 'main.c'), '#include <stdio.h>\nint main() { return 0; }\n');
    fs.writeFileSync(path.join(tmpDir, 'src', 'helper.h'), '#ifndef HELPER_H\n#define HELPER_H\n#endif\n');

    const ws = detectWorkspace(tmpDir);
    assert.strictEqual(ws.hasCpp, true, 'pure .c workspace without Makefile must have hasCpp: true');

    const stack = detectStack(tmpDir);
    assert.strictEqual(stack.cpp.enabled, true, 'pure .c workspace should detect cpp stack');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

testBuildLanguageSupportMatrix();
testBuildLanguageSupportMatrixEmpty();
testPureCWorkspaceDetection();

