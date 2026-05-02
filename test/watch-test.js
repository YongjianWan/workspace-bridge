#!/usr/bin/env node
/**
 * Watch command integration test.
 * Spawns the watch CLI, triggers a file change, and verifies impact output.
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const repoRoot = path.join(__dirname, '..');
const cliPath = path.join(repoRoot, 'cli.js');
const tempFile = path.join(repoRoot, 'watch-test-temp-file.js');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cleanup() {
  try {
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
  } catch {
    // ignore
  }
}

async function main() {
  console.log('=== workspace-bridge watch test ===\n');

  await cleanup();

  const child = spawn('node', [cliPath, 'watch', '--cwd', '.'], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (data) => {
    stdout += data.toString();
  });

  child.stderr.on('data', (data) => {
    stderr += data.toString();
  });

  // Wait for startup message
  let waited = 0;
  while (!stderr.includes('Watching for file changes') && waited < 15000) {
    await delay(100);
    waited += 100;
  }

  assert(stderr.includes('workspace-bridge watch'), 'Should show watch header');
  assert(stderr.includes('Watching for file changes'), 'Should show watching message');
  console.log('watch startup: ok');

  // Create a temp file to trigger the watcher
  fs.writeFileSync(tempFile, '// watch test temp file\n');

  // Wait for debounce (500ms) + processing
  await delay(2500);

  // Kill the process
  child.kill();

  // Wait for exit
  await new Promise((resolve) => {
    child.on('exit', resolve);
    child.on('error', resolve);
    setTimeout(resolve, 3000);
  });

  await cleanup();

  // Verify impact was printed for the temp file
  assert(
    stdout.includes('watch-test-temp-file.js changed'),
    `Should print impact for temp file. stdout: ${stdout}`,
  );
  console.log('watch file change impact: ok');
}

main().catch(async (err) => {
  await cleanup();
  console.error('Test failed:', err.message);
  process.exit(1);
});
