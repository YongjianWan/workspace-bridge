#!/usr/bin/env node
// @semantic
/**
 * Verify that --cwd subdirectory restricted analysis works:
 * 1. Default strictCwd is true, scanning only the subdirectory.
 * 2. git-tools correctly maps and filters files relative to workspaceRoot.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const assert = require('assert');
const { cleanupTempDir } = require('./test-helpers');
const { ServiceContainer } = require('../src/services/container');
const gitTools = require('../src/tools/git-tools');
const { runGit } = require('../src/utils/command');

async function main() {
  const testDir = path.join(os.tmpdir(), 'wb-test-strict-cwd-' + crypto.randomBytes(4).toString('hex'));
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }

  // Initialize git repository to test git-tools
  await runGit(['init'], testDir);
  await runGit(['config', 'user.name', 'Test'], testDir);
  await runGit(['config', 'user.email', 'test@example.com'], testDir);

  fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify({ name: 'strict-cwd-test', version: '1.0.0' }, null, 2));
  
  // Create subdirectory structure
  const subDir = path.join(testDir, 'src');
  fs.mkdirSync(subDir, { recursive: true });

  const fileInRoot = path.join(testDir, 'root-file.js');
  const fileInSub = path.join(subDir, 'sub-file.js');

  fs.writeFileSync(fileInRoot, 'console.log("root");\n');
  fs.writeFileSync(fileInSub, 'console.log("sub");\n');

  // Commit files to git
  await runGit(['add', '.'], testDir);
  await runGit(['commit', '-m', 'initial commit'], testDir);

  try {
    // 1. Verify strictCwd default (should be true) and scans ONLY the subdirectory
    const container = new ServiceContainer({ quiet: true });
    // Default strictCwd is true when initialized on subDir
    const initialized = await container.initialize(subDir, 30000, {
      watch: false,
      strictCwd: true, // explicitly true to verify container logic
    });
    assert.ok(initialized);
    assert.strictEqual(container.workspaceRoot, subDir);

    const files = container.snapshot.graph.getAllFilePaths();
    assert.strictEqual(files.length, 1, 'Should only index 1 file inside subDir');
    assert.ok(files[0].endsWith('sub-file.js'), 'Indexed file should be sub-file.js');
    await container.shutdown();

    // 2. Verify git-tools mapping & filtering when root is subDir
    // Modify both root-file.js and sub-file.js
    fs.writeFileSync(fileInRoot, 'console.log("root-modified");\n');
    fs.writeFileSync(fileInSub, 'console.log("sub-modified");\n');

    // Query changed files relative to subDir
    const result = await gitTools.getChangedFiles(subDir, { staged: false });
    assert.ok(result.ok);
    assert.strictEqual(result.workspaceRoot, subDir);
    
    // Result should ONLY contain sub-file.js, formatted relative to subDir
    assert.strictEqual(result.changedFiles.length, 1);
    assert.strictEqual(result.changedFiles[0], 'sub-file.js', 'Should report change relative to subDir');

    // Query numstat relative to subDir
    const numstat = await gitTools.getDiffNumstat(subDir, { staged: false });
    assert.ok(numstat.ok);
    assert.strictEqual(numstat.files.length, 1);
    assert.strictEqual(numstat.files[0].file, 'sub-file.js');

    console.log('PASS: subdirectory-strict-cwd-test');
  } finally {
    cleanupTempDir(testDir);
  }
}

main().catch((err) => {
  console.error('FAIL: subdirectory-strict-cwd-test failed:', err);
  process.exit(1);
});
