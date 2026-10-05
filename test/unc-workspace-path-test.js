#!/usr/bin/env node
// @fast
// @semantic
/**
 * Windows: a UNC path inside a UNC workspace root is a legitimate file; a UNC path outside it,
 * and a drive-relative "/src", stay rejected.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');
const { resolveWorkspaceFilePath } = require('../src/utils/path');

if (process.platform !== 'win32') {
  console.log('skipped: Windows path semantics only');
  process.exit(0);
}

// The localhost admin share (two backslashes, localhost, C$, ...) is a UNC view of a real local directory.
const BS = String.fromCharCode(92);
function toUnc(localPath) {
  const [drive, ...rest] = path.resolve(localPath).split(path.sep);
  return [BS + BS + 'localhost', drive.replace(':', '$'), ...rest].join(BS);
}

const dir = makeTempDir('wb-unc-');
try {
  const file = path.join(dir, 'a.js');
  fs.writeFileSync(file, 'module.exports = 1;\n');
  const uncRoot = toUnc(dir);
  const uncFile = uncRoot + BS + 'a.js';

  assert.notStrictEqual(resolveWorkspaceFilePath(uncFile, uncRoot), null, 'UNC file inside UNC root must resolve');
  assert.notStrictEqual(resolveWorkspaceFilePath('a.js', uncRoot), null, 'relative file under a UNC root must resolve');
  assert.strictEqual(resolveWorkspaceFilePath(toUnc(path.join(dir, '..', 'outside.js')), uncRoot), null, 'UNC file outside the root is rejected');
  assert.strictEqual(resolveWorkspaceFilePath('/src/a.js', dir), null, 'drive-relative absolute path is rejected');
} finally {
  cleanupTempDir(dir);
}
