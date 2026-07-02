#!/usr/bin/env node
// @semantic
/**
 * Regression protection tests for path normalization and cross-platform resolution.
 * Verifies that Windows backslashes, mixed slashes, and relative paths are normalized consistently.
 */

const assert = require('assert');
const path = require('path');
const pathUtils = require('../src/utils/path');

function testNormalizePathKey() {
  const root = 'C:\\Users\\test\\project';
  const p1 = 'C:\\Users\\test\\project\\src\\core\\walkers.js';
  const p2 = 'C:/Users/test/project/src/core/walkers.js';
  const p3 = 'c:\\users\\test\\project\\src\\core\\walkers.js';

  const k1 = pathUtils.normalizePathKey(p1);
  const k2 = pathUtils.normalizePathKey(p2);
  const k3 = pathUtils.normalizePathKey(p3);

  if (process.platform === 'win32') {
    assert.strictEqual(k1, k2, 'normalizePathKey should handle backslashes and forward slashes identically');
    assert.strictEqual(k1, k3, 'normalizePathKey should normalize case on Windows');
    assert.ok(k1.includes('/'), 'Normalized keys must use POSIX slashes');
    assert.ok(!k1.includes('\\'), 'Normalized keys must not contain backslashes');
  } else {
    assert.strictEqual(k1, k2);
  }
}

function testNormalizeFilePath() {
  const workspaceRoot = process.platform === 'win32' ? 'C:/Workspace' : '/Workspace';
  const relPathBackslash = 'src\\utils\\path.js';
  const relPathForward = 'src/utils/path.js';

  const nk1 = pathUtils.normalizeFilePath(relPathBackslash, workspaceRoot);
  const nk2 = pathUtils.normalizeFilePath(relPathForward, workspaceRoot);

  assert.strictEqual(nk1, nk2, 'normalizeFilePath should treat relative backslashes and forward slashes identically');
  assert.ok(nk1.endsWith('src/utils/path.js'));
}

function testResolveWorkspaceFilePath() {
  const workspaceRoot = process.platform === 'win32' ? 'C:\\Workspace' : '/Workspace';

  // 1. Valid relative path with backslashes
  const r1 = pathUtils.resolveWorkspaceFilePath('src\\utils\\path.js', workspaceRoot);
  assert.ok(r1, 'Should resolve valid relative path');
  assert.ok(r1.replace(/\\/g, '/').endsWith('Workspace/src/utils/path.js'));

  // 2. Escape attempt (path outside root)
  const r2 = pathUtils.resolveWorkspaceFilePath('..\\..\\etc\\passwd', workspaceRoot);
  assert.strictEqual(r2, null, 'Should reject path traversing outside workspace root');

  const r3 = pathUtils.resolveWorkspaceFilePath('../etc/passwd', workspaceRoot);
  assert.strictEqual(r3, null, 'Should reject traversing outside root via forward slashes');

  // 3. absolute paths inside vs outside
  if (process.platform === 'win32') {
    const inside = pathUtils.resolveWorkspaceFilePath('C:\\Workspace\\src\\file.js', workspaceRoot);
    assert.ok(inside);

    const outside = pathUtils.resolveWorkspaceFilePath('C:\\Windows\\System32\\cmd.exe', workspaceRoot);
    assert.strictEqual(outside, null, 'Should reject absolute path outside workspace root');
    
    const leadingSlash = pathUtils.resolveWorkspaceFilePath('/escape', workspaceRoot);
    assert.strictEqual(leadingSlash, null, 'Should reject leading slash paths on Windows');
  } else {
    const inside = pathUtils.resolveWorkspaceFilePath('/Workspace/src/file.js', workspaceRoot);
    assert.ok(inside);

    const outside = pathUtils.resolveWorkspaceFilePath('/usr/bin/env', workspaceRoot);
    assert.strictEqual(outside, null, 'Should reject absolute path outside workspace root on POSIX');
  }
}

// Case 4: isPathInsideRoot bounds checking
function testIsPathInsideRoot() {
  const root = process.platform === 'win32' ? 'C:\\my-project' : '/my-project';

  assert.ok(pathUtils.isPathInsideRoot(root, root));
  assert.ok(pathUtils.isPathInsideRoot(root, root + (process.platform === 'win32' ? '\\src' : '/src')));
  assert.ok(pathUtils.isPathInsideRoot(root, root + (process.platform === 'win32' ? '\\src\\core\\..\\file.js' : '/src/core/../file.js')));
  
  assert.strictEqual(pathUtils.isPathInsideRoot(root, process.platform === 'win32' ? 'C:\\other' : '/other'), false);
  assert.strictEqual(pathUtils.isPathInsideRoot(root, root + '/../outside'), false);
}

function testToRelativePosix() {
  const root = process.platform === 'win32' ? 'C:\\project' : '/project';
  const target = process.platform === 'win32' ? 'C:\\project\\src\\utils\\path.js' : '/project/src/utils/path.js';

  const rel = pathUtils.toRelativePosix(root, target);
  assert.strictEqual(rel, 'src/utils/path.js');

  const mixed = pathUtils.toRelativePosix(root, process.platform === 'win32' ? 'C:\\project/src\\utils/path.js' : '/project/src/utils/path.js');
  assert.strictEqual(mixed, 'src/utils/path.js');
}

function testMatchesPathFragment() {
  const filePath = 'src/services/dep-graph/analyzer.js';
  
  assert.ok(pathUtils.matchesPathFragment(filePath, 'dep-graph'));
  assert.ok(pathUtils.matchesPathFragment(filePath, 'dep-graph/analyzer.js'));
  assert.ok(pathUtils.matchesPathFragment(filePath, 'src/services'));

  if (process.platform === 'win32') {
    assert.ok(pathUtils.matchesPathFragment(filePath, 'DEP-GRAPH'));
  }
  
  assert.ok(pathUtils.matchesPathFragment('src\\services\\dep-graph\\analyzer.js', 'services/dep-graph'));
}

function testFromNormalizedKey() {
  const key = 'c:/workspace/src/utils/path.js';
  const native = pathUtils.fromNormalizedKey(key);
  if (process.platform === 'win32') {
    assert.strictEqual(native, 'c:\\workspace\\src\\utils\\path.js');
  } else {
    assert.strictEqual(native, key);
  }
}

function main() {
  testNormalizePathKey();
  testNormalizeFilePath();
  testResolveWorkspaceFilePath();
  testIsPathInsideRoot();
  testToRelativePosix();
  testMatchesPathFragment();
  testFromNormalizedKey();
  console.log('PASS: path-normalization-cross-platform-test');
}

main();
