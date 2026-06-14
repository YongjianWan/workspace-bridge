#!/usr/bin/env node
// @contract
/**
 * CLI integration tests — edge cases and boundary behaviors.
 * Covers path sanitization, pipe/BOM, Java BOM parsing, physical path escape,
 * WASM fallback, and debug graph.
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { runCliInProcess, runCliInProcessRaw, makeTempDir, cleanupTempDir, runInDir } = require('./test-helpers');

function writeFile(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

function initGit(root) {
  runInDir('git', ['init'], root);
  runInDir('git', ['config', 'user.email', 'test@example.com'], root);
  runInDir('git', ['config', 'user.name', 'Test User'], root);
  runInDir('git', ['add', '.'], root);
  runInDir('git', ['commit', '-m', 'init'], root);
}

async function testPathSanitization() {
  const tempRoot = makeTempDir('wb-cli-path-sanitization-');
  try {
    writeFile(tempRoot, 'package.json', JSON.stringify({ name: 'ps-test', version: '1.0.0', main: 'src/app.js' }, null, 2));
    writeFile(tempRoot, 'src/app.js', 'export function run() { return 1; }\n');
    initGit(tempRoot);

    // --file with path traversal should be rejected
    const badFile = await runCliInProcessRaw(['impact', '--cwd', tempRoot, '--file', '../escape.js', '--json', '--quiet']);
    assert.strictEqual(badFile.status, 1, 'path traversal in --file should exit 1');
    assert(badFile.stdout.includes('path traversal') || badFile.stderr.includes('path traversal') || badFile.stdout.includes('path_error') || badFile.stderr.includes('path_error'), 'should mention path traversal or path_error');

    // --files with path traversal should be rejected
    const badFiles = await runCliInProcessRaw(['audit-security', '--cwd', tempRoot, '--files', 'src/app.js,../evil.js', '--json', '--quiet']);
    assert.strictEqual(badFiles.status, 1, 'path traversal in --files should exit 1');

    // Normal relative path should succeed
    const good = await runCliInProcess(['impact', '--cwd', tempRoot, '--file', 'src/app.js', '--json', '--quiet']);
    assert.strictEqual(good.ok, true, 'normal --file should succeed');
  } finally {
    cleanupTempDir(tempRoot);
  }
}

function testCliPipeAndBom() {
  const tempRoot = makeTempDir('wb-cli-pipe-bom-');
  try {
    writeFile(tempRoot, 'package.json', JSON.stringify({ name: 'pb-test', version: '1.0.0' }));
    initGit(tempRoot);

    const cliPath = path.join(__dirname, '..', 'cli.js');
    
    // Test direct piping from node cli.js to another node process, ensuring BOM clean parsing
    const cmd = `node "${cliPath}" audit-summary --cwd "${tempRoot}" --json --quiet`;
    const pipedCmd = `${cmd} | node -e "let d=''; process.stdin.on('data', c=>d+=c); process.stdin.on('end', ()=>{ let raw=d.trim(); if(raw.charCodeAt(0)===0xFEFF){raw=raw.slice(1)} const obj=JSON.parse(raw); console.log(obj.ok ? 'OK' : 'FAIL'); })"`;
    
    const output = execSync(pipedCmd, { encoding: 'utf8' }).trim();
    assert.strictEqual(output, 'OK', 'PowerShell/shell piping E2E should pass and parse correctly');
  } finally {
    cleanupTempDir(tempRoot);
  }
}

async function testJavaBomParsing() {
  const tempRoot = makeTempDir('wb-cli-java-bom-');
  try {
    writeFile(tempRoot, 'package.json', JSON.stringify({ name: 'java-bom-test', version: '1.0.0' }));
    writeFile(tempRoot, 'pom.xml', '<project></project>');
    writeFile(tempRoot, 'src/main/java/com/test/App.java', '\uFEFFpackage com.test;\npublic class App {\n  public void hello() {}\n}\n');
    initGit(tempRoot);

    const result = await runCliInProcess(['audit-summary', '--cwd', tempRoot, '--json', '--quiet']);
    assert.strictEqual(result.ok, true, 'should parse BOM-prepended Java file');
    assert.strictEqual(result.scope?.counts?.totalFiles, 1, 'should find Java file');
  } finally {
    cleanupTempDir(tempRoot);
  }
}

function testPathEscapePhysicalInterception() {
  const tempRoot = makeTempDir('wb-cli-escape-');
  try {
    const cliPath = path.join(__dirname, '..', 'cli.js');
    const cliCmd = `node "${cliPath}" impact --cwd "${tempRoot}" --file "../outside.js" --json --quiet`;
    let exitedWithOne = false;
    let output = '';
    try {
      output = execSync(cliCmd, { encoding: 'utf8', stdio: 'pipe' });
    } catch (err) {
      exitedWithOne = (err.status === 1);
      output = err.stdout + err.stderr;
    }
    assert(exitedWithOne, 'Should exit with code 1 on path traversal escape');
  } finally {
    cleanupTempDir(tempRoot);
  }
}

async function testWasmFailureFallback() {
  const tempRoot = makeTempDir('wb-cli-wasm-fallback-');
  try {
    writeFile(tempRoot, 'package.json', JSON.stringify({ name: 'wasm-fallback-test', version: '1.0.0' }));
    writeFile(tempRoot, 'go.mod', 'module wasm-fallback-test\n');
    writeFile(tempRoot, 'src/main.go', 'package main\nimport "fmt"\nfunc Main() { fmt.Println("hello") }\n');
    initGit(tempRoot);

    const result = await runCliInProcess(['audit-summary', '--cwd', tempRoot, '--json', '--quiet'], {
      env: { ...process.env, FORCE_WASM_FAIL: 'true' }
    });

    assert.strictEqual(result.ok, true, 'WASM failure fallback should still succeed on audit-summary');
    assert.strictEqual(result.scope?.counts?.totalFiles, 1, 'should find go file');
  } finally {
    cleanupTempDir(tempRoot);
  }
}

async function testDebugGraph() {
  const result = await runCliInProcess(['debug', '--what', 'graph', '--json', '--quiet']);
  assert.strictEqual(result.ok, true, 'debug --what graph should return ok');
  assert.strictEqual(result.what, 'graph', 'what should be graph');
  assert(Number.isFinite(result.fileCount) && result.fileCount > 0, 'graph should return positive fileCount');
  assert(Number.isFinite(result.edgeCount) && result.edgeCount >= 0, 'graph should return non-negative edgeCount');
  assert(Array.isArray(result.sampleFiles), 'graph should return sampleFiles array');
}

async function main() {
  await testPathSanitization();
  await testCliPipeAndBom();
  await testJavaBomParsing();
  await testPathEscapePhysicalInterception();
  await testWasmFailureFallback();
  await testDebugGraph();
  console.log('cli-integration-edge-test.js: all passed');
}

main();
