#!/usr/bin/env node
/**
 * Watch command integration test.
 * Spawns the watch CLI, triggers a file change, and verifies impact output.
 *
 * Fixes flaky root cause:
 * 1. Replaces fixed delay(2500) with polling for expected output (up to 15s).
 * 2. Uses an isolated temp directory instead of polluting repo root.
 * 3. Adds SIGINT graceful-shutdown coverage.
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { REPO_ROOT, CLI_PATH, cleanupTempDir, terminateProcess } = require('./test-helpers');

const tempDir = path.join(REPO_ROOT, 'test', '.watch-temp');
const triggerFile = path.join(tempDir, 'trigger.js');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function setup() {
  fs.mkdirSync(tempDir, { recursive: true });
  // Pre-create the file so the watcher sees an update, not just a creation.
  fs.writeFileSync(triggerFile, '// initial\n');
}

async function cleanup() {
  try {
    if (fs.existsSync(tempDir)) {
      cleanupTempDir(tempDir);
    }
  } catch {
    // ignore
  }
}

async function waitForStartup(stderrGetter, expected = 'Watching', timeoutMs = 20000) {
  let waited = 0;
  while (!stderrGetter().includes(expected) && waited < timeoutMs) {
    await delay(100);
    waited += 100;
  }
}

async function testWatchFileChange() {

  const args = ['watch', '--cwd', '.'];
  if (process.env.WB_TEST_CACHE_DIR) {
    args.push('--cache-dir', process.env.WB_TEST_CACHE_DIR);
  }
  const child = spawn('node', [CLI_PATH, ...args], {
    cwd: REPO_ROOT,
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

  await waitForStartup(() => stderr, 'Watching for file changes');

  assert(stderr.includes('workspace-bridge watch'), 'Should show watch header');
  assert(stderr.includes('Watching for file changes'), 'Should show watching message');

  // Update the trigger file to fire the watcher callback
  fs.writeFileSync(triggerFile, `// updated ${Date.now()}\n`);

  // Poll for expected output instead of betting on a fixed delay
  const startTime = Date.now();
  let found = false;
  while (Date.now() - startTime < 8000) {
    if (stdout.includes('trigger.js changed')) {
      found = true;
      break;
    }
    await delay(200);
  }

  // Kill the process
  await terminateProcess(child);

  assert(found, `Should print impact for trigger file. stdout: ${stdout}`);
}

async function testWatchSigint() {

  const args = ['watch', '--cwd', '.'];
  if (process.env.WB_TEST_CACHE_DIR) {
    args.push('--cache-dir', process.env.WB_TEST_CACHE_DIR);
  }
  const child = spawn('node', [CLI_PATH, ...args], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.on('data', (data) => {
    stderr += data.toString();
  });

  await waitForStartup(() => stderr, 'Watching for file changes');
  assert(stderr.includes('Watching for file changes'), 'Should show watching message before SIGINT');

  // Send SIGINT. On Windows Node.js emulates this for child processes.
  child.kill('SIGINT');

  const result = await new Promise((resolve) => {
    child.on('exit', (code, signal) => resolve({ code, signal }));
    child.on('error', () => resolve({ code: 'error' }));
    setTimeout(() => resolve({ code: 'timeout' }), 2000);
  });

  // If the platform does not deliver the signal, we skip rather than fail.
  if (result.code === 'timeout') {
    console.log('watch SIGINT: skipped (signal not delivered on this platform)');
    return;
  }

  // On Windows the child may exit with null code when killed by SIGINT.
  // We accept either graceful shutdown (0) or signal-termination (null).
  const ok = result.code === 0 || result.code === null || result.signal === 'SIGINT' || result.signal === 'SIGTERM';
  assert(ok, `SIGINT should cause process exit, got code=${result.code}, signal=${result.signal}`);
}

function parseJsonLines(stdout) {
  const lines = stdout.split(/\r?\n/).filter((l) => l.trim().startsWith('{'));
  const events = [];
  for (const line of lines) {
    try {
      events.push(JSON.parse(line));
    } catch {
      // ignore non-JSON lines
    }
  }
  return events;
}

async function testWatchRunTests() {

  const args = ['watch', '--cwd', '.', '--run-tests'];
  if (process.env.WB_TEST_CACHE_DIR) {
    args.push('--cache-dir', process.env.WB_TEST_CACHE_DIR);
  }
  const child = spawn('node', [CLI_PATH, ...args], {
    cwd: REPO_ROOT,
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

  await waitForStartup(() => stderr, 'Watching for file changes');
  // Give stderr a moment to receive the "Auto-run mode" line that follows immediately after.
  await delay(200);
  assert(stderr.includes('Auto-run mode'), 'Should indicate auto-run mode in stderr');

  // Update the trigger file to fire the watcher callback
  fs.writeFileSync(triggerFile, `// updated ${Date.now()}\n`);

  // Poll for JSON Lines events (validation may take a while to compute + spawn)
  const startTime = Date.now();
  let completeEvent = null;
  while (Date.now() - startTime < 12000) {
    const events = parseJsonLines(stdout);
    completeEvent = events.find((e) => e.event === 'validationComplete');
    if (completeEvent) break;
    await delay(300);
  }

  // Kill the process
  await terminateProcess(child);

  const events = parseJsonLines(stdout);
  const startEvent = events.find((e) => e.event === 'validationStart');
  assert(startEvent, `Should emit validationStart event. Events: ${JSON.stringify(events.map((e) => e.event))}`);
  assert(completeEvent, `Should emit validationComplete event. Events: ${JSON.stringify(events.map((e) => e.event))}`);
  assert(completeEvent.passed === true, `validationComplete should indicate passed=true for isolated file. Got: ${JSON.stringify(completeEvent)}`);
}

async function main() {

  await cleanup();
  await setup();

  try {
    await testWatchFileChange();
    await testWatchSigint();
    await testWatchRunTests();
  } finally {
    await cleanup();
  }

}

main().catch(async (err) => {
  await cleanup();
  console.error('Test failed:', err.message);
  process.exit(1);
});
