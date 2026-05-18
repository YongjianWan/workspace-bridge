#!/usr/bin/env node
/**
 * Security test suite for workspace-bridge
 * Tests injection protection and path traversal defenses
 */

const path = require('path');

// Import functions to test
const { sanitizeSymbolName, sanitizeShellArg } = require('../src/utils/sanitize');
const { runCommandSecure, runGit } = require('../src/utils/command');
const { resolveWorkspaceFilePath } = require('../src/utils/path');
/** Minimal ReDoS query validator (inlined after search-tools removal) */
function validateQuery(query) {
  if (!query || typeof query !== 'string') {
    return { valid: false, error: 'query is required' };
  }
  if (query.length > 100) {
    return { valid: false, error: 'query too long (max 100 chars)' };
  }
  const dangerousPatterns = [
    new RegExp('\\([^()]*[+\\*][^()]*\\)[+*]'),
    /\+\+/,
    /\*\+/,
    /\+\*/,
    /\{\d+,\d+\}\+/,
    /\[.*\]\+.*\[.*\]\+/,
  ];
  if (dangerousPatterns.some(p => p.test(query))) {
    return { valid: false, error: 'query contains potentially dangerous pattern' };
  }
  return { valid: true };
}

// Test utilities
function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exitCode = 1;
    return false;
  }
  return true;
}

function test(name, fn) {
  try {
    fn();
  } catch (e) {
    console.error(`❌ FAIL: ${name} - ${e.message}`);
    process.exitCode = 1;
  }
}



// Test 1: Path traversal prevention


const workspaceRoot = process.platform === 'win32' 
  ? 'C:\\projects\\myapp' 
  : '/home/user/projects/myapp';

test('should block absolute path outside workspace', () => {
  const outsidePath = process.platform === 'win32' 
    ? 'C:\\Windows\\System32\\secret.txt'
    : '/etc/passwd';
  const result = resolveWorkspaceFilePath(outsidePath, workspaceRoot);
  assert(result === null, 'Absolute path outside workspace should be rejected');
});

test('should block relative path traversal', () => {
  const result = resolveWorkspaceFilePath('../../../etc/passwd', workspaceRoot);
  assert(result === null, 'Relative path traversal should be rejected');
});

test('should allow valid file inside workspace', () => {
  const result = resolveWorkspaceFilePath('src/index.js', workspaceRoot);
  assert(result !== null, 'Valid file inside workspace should be allowed');
});

// Test 2: Symbol name sanitization


test('should allow valid identifier', () => {
  assert(sanitizeSymbolName('myFunction') === 'myFunction', 'Valid identifier should pass');
  assert(sanitizeSymbolName('_private') === '_private', 'Private identifier should pass');
});

test('should block identifiers starting with digit', () => {
  assert(sanitizeSymbolName('123function') === '', 'Identifier starting with digit should be rejected');
});

test('should remove special characters', () => {
  assert(sanitizeSymbolName('func;rm -rf /') === 'funcrmrf', 'Special chars should be removed');
  assert(sanitizeSymbolName('class$(whoami)') === 'classwhoami', 'Command substitution should be removed');
});

test('should handle edge cases', () => {
  assert(sanitizeSymbolName('') === '', 'Empty string should return empty');
  assert(sanitizeSymbolName(null) === '', 'Null should return empty');
  assert(sanitizeSymbolName(undefined) === '', 'Undefined should return empty');
});

// Test 3: Shell argument sanitization


test('should remove dangerous characters', () => {
  assert(sanitizeShellArg('file;rm -rf /') === 'filerm-rf', 'Semicolon should be removed');
  assert(sanitizeShellArg('file|cat /etc/passwd') === 'filecatetcpasswd', 'Pipe should be removed');
});

test('should allow safe characters', () => {
  assert(sanitizeShellArg('file_name-123.txt') === 'file_name-123.txt', 'Safe filename should pass');
});

// Test 4: Search query ReDoS protection


test('should reject nested quantifier patterns', () => {
  assert(validateQuery('(a+)+').valid === false, 'Nested + quantifiers should be rejected');
  assert(validateQuery('(a*)*').valid === false, 'Nested * quantifiers should be rejected');
});

// Test 5: Command execution safety


async function runAsyncTests() {
  test('runCommandSecure should return a Promise', async () => {
    // 使用 node -e 代替 echo，确保跨平台可用
    const result = runCommandSecure(process.execPath, ['-e', 'console.log("hello")'], process.cwd(), 5000);
    assert(result instanceof Promise, 'runCommandSecure should return a Promise');
    
    const resolved = await result;
    assert(resolved.ok === true, 'node command should succeed');
  });



  if (process.exitCode === 1) {

    process.exit(1);
  } else {

  }
}

runAsyncTests().catch(e => {
  console.error('Test suite error:', e);
  process.exit(1);
});
