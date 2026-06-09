// @semantic
// @slow
// Regression archive for known unresolved imports false-positive scenarios.
// If a previously-fixed FP recurs, this test fails.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { runCliRaw, makeTempDir, cleanupTempDir } = require('./test-helpers');

const tempDir = makeTempDir('wb-fp-unres-');

// ---fixture setup-------------------------------------------------------------
fs.mkdirSync(path.join(tempDir, 'src', 'utils'), { recursive: true });
fs.writeFileSync(
  path.join(tempDir, 'package.json'),
  JSON.stringify({ name: 'fp-unres', version: '1.0.0' }),
  'utf8'
);

// 1) JavaScript/TypeScript imports
fs.writeFileSync(
  path.join(tempDir, 'src', 'main.js'),
  `import fs from 'node:fs';
import path from 'path';
import express from 'express';
import { something } from './utils/helper.js';
import './nonexistent.js';
`,
  'utf8'
);

fs.writeFileSync(
  path.join(tempDir, 'src', 'utils', 'helper.js'),
  `export const something = 42;\n`,
  'utf8'
);

// 2) Java wildcard and same-package implicit imports
fs.writeFileSync(
  path.join(tempDir, 'src', 'A.java'),
  `package com.example.app;
import com.foo.bar.*;
public class A {
  public void hello() {
    B b = new B();
  }
}
`,
  'utf8'
);

fs.writeFileSync(
  path.join(tempDir, 'src', 'B.java'),
  `package com.example.app;
public class B {}
`,
  'utf8'
);

// ---helpers-----------------------------------------------------------------
function runUnresolved(cwd) {
  return runCliRaw(['unresolved', '--cwd', cwd, '--json', '--quiet'], { cwd });
}

function parseJsonSafe(result) {
  let stdout = result.stdout;
  if (stdout && stdout.startsWith('\ufeff')) stdout = stdout.slice(1);
  return JSON.parse(stdout);
}

// ---tests-------------------------------------------------------------------
function testUnresolvedImports() {
  const result = runUnresolved(tempDir);
  assert.strictEqual(result.status, 0, `CLI failed: ${result.stderr}`);
  const data = parseJsonSafe(result);

  assert.ok(Array.isArray(data.unresolved), 'unresolved should be an array');

  // We expect exactly 1 unresolved import: from main.js to nonexistent.js
  const unresolvedList = data.unresolved;
  
  // 1) Verify that nonexistent.js is flagged as unresolved
  const nonexistent = unresolvedList.find(u => u.import && u.import.includes('nonexistent.js'));
  assert.ok(nonexistent, `Expected './nonexistent.js' to be unresolved, got: ${JSON.stringify(unresolvedList)}`);
  assert.strictEqual(nonexistent.resolvedTo, null, 'resolvedTo for unresolved imports should be null');

  // 2) Verify that Node.js built-ins (fs, path) are NOT unresolved
  const builtInFs = unresolvedList.find(u => u.import === 'node:fs');
  const builtInPath = unresolvedList.find(u => u.import === 'path');
  assert.strictEqual(builtInFs, undefined, 'node:fs should not be reported as unresolved');
  assert.strictEqual(builtInPath, undefined, 'path should not be reported as unresolved');

  // 3) Verify that external libraries (express) are NOT unresolved
  const expressLib = unresolvedList.find(u => u.import === 'express');
  assert.strictEqual(expressLib, undefined, 'express should not be reported as unresolved');

  // 4) Verify that valid relative paths (helper.js) are NOT unresolved
  const helper = unresolvedList.find(u => u.import && u.import.includes('helper.js'));
  assert.strictEqual(helper, undefined, 'helper.js should not be reported as unresolved');

  // 5) Verify that Java wildcard imports (com.foo.bar.*) are NOT unresolved
  const wildcard = unresolvedList.find(u => u.import && u.import.includes('com.foo.bar.*'));
  assert.strictEqual(wildcard, undefined, 'com.foo.bar.* wildcard import should not be reported as unresolved');

  // 6) Verify that Java same-package implicit imports (A.java / B.java) are NOT unresolved
  const javaA = unresolvedList.find(u => u.import && u.import.includes('A.java'));
  const javaB = unresolvedList.find(u => u.import && u.import.includes('B.java'));
  assert.strictEqual(javaA, undefined, 'A.java should not have unresolved imports to B');
  assert.strictEqual(javaB, undefined, 'B.java should not have unresolved imports to A');

  // Overall count should be exactly 1
  assert.strictEqual(
    unresolvedList.length,
    1,
    `Expected exactly 1 unresolved import, got ${unresolvedList.length}: ${JSON.stringify(unresolvedList)}`
  );
}

// ---main--------------------------------------------------------------------
function main() {
  try {
    testUnresolvedImports();
  } finally {
    cleanupTempDir(tempDir);
  }
}

main();
