// @semantic
// Cross-platform path normalization regression tests.
// Validates that POSIX forward slashes and Windows backslashes resolve to
// identical normalized keys, drive letters are normalized case-insensitively on Windows,
// and path resolvers handle mixed slashes correctly.

const assert = require('assert');
const path = require('path');
const {
  normalizePath,
  normalizePathKey,
  normalizeFilePath,
  toRelativePosix,
  resolveWorkspaceFilePath,
} = require('../src/utils/path');

function testSlashEquivalence() {
  const root = process.platform === 'win32' ? 'C:\\workspace' : '/workspace';
  
  // Forward and backward slashes should yield the same normalized filePath
  const key1 = normalizeFilePath('src/services/container.js', root);
  const key2 = normalizeFilePath('src\\services\\container.js', root);
  
  assert.strictEqual(key1, key2, 'Forward and backward slashes must produce identical keys');
  assert(key1.endsWith('src/services/container.js'), 'Normalized path keys must use POSIX slashes');
}

function testDriveLetterCasing() {
  if (process.platform !== 'win32') {
    // POSIX path drive letters do not apply
    return;
  }

  // Upper and lower case Windows drive letters should yield identical normalized keys
  const keyUpper = normalizeFilePath('C:\\workspace\\src\\a.js', 'C:\\workspace');
  const keyLower = normalizeFilePath('c:\\workspace\\src\\a.js', 'C:\\workspace');

  assert.strictEqual(keyUpper, keyLower, 'Drive letters must be normalized case-insensitively');
  
  // Also check normalizePathKey directly
  const path1 = normalizePathKey('C:\\Foo');
  const path2 = normalizePathKey('c:\\Foo');
  assert.strictEqual(path1, path2, 'normalizePathKey must normalize drive casing');
}

function testMixedSeparatorWorkspaceResolving() {
  const root = process.platform === 'win32' ? 'C:\\workspace' : '/workspace';

  const resolved1 = resolveWorkspaceFilePath('src/utils/path.js', root);
  const resolved2 = resolveWorkspaceFilePath('src\\utils\\path.js', root);

  assert.strictEqual(resolved1, resolved2, 'resolveWorkspaceFilePath must yield identical paths for different separators');

  // Verify resolveWorkspaceFilePath handles mixed separators
  const resolvedMixed = resolveWorkspaceFilePath('src\\utils/path.js', root);
  assert.strictEqual(resolved1, resolvedMixed, 'Mixed separator resolving failed');
}

function testRelativePosixNormalization() {
  const root = process.platform === 'win32' ? 'C:\\workspace' : '/workspace';
  const target = process.platform === 'win32' ? 'C:\\workspace\\src\\a.js' : '/workspace/src/a.js';

  const rel = toRelativePosix(root, target);
  assert.strictEqual(rel, 'src/a.js', 'toRelativePosix must return POSIX slashes');
}

function main() {
  testSlashEquivalence();
  testDriveLetterCasing();
  testMixedSeparatorWorkspaceResolving();
  testRelativePosixNormalization();
  console.log('Path crossplatform regression tests passed.');
}

main();
