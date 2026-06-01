#!/usr/bin/env node
/**
 * audit-file --watch integration test.
 * Spawns the CLI in watch mode, triggers a file change, and verifies
 * the full audit-file JSON Lines event stream.
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { REPO_ROOT, CLI_PATH, cleanupTempDir } = require('./test-helpers');

const tempDir = path.join(REPO_ROOT, 'test', '.watch-temp');
const triggerFile = path.join(tempDir, 'trigger.js');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function setup() {
  fs.mkdirSync(tempDir, { recursive: true });
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

async function waitForStartup(childStderr, timeoutMs = 8000) {
  let waited = 0;
  while (!childStderr.includes('Press Ctrl+C to stop') && waited < timeoutMs) {
    await delay(100);
    waited += 100;
  }
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

async function testAuditFileWatch() {

  const relativeTrigger = path.relative(REPO_ROOT, triggerFile);
  const child = spawn('node', [CLI_PATH, 'audit-file', '--file', relativeTrigger, '--watch', '--json'], {
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

  await waitForStartup(stderr);
  assert(stderr.includes('audit-file --watch'), 'Should show audit-file watch header');
  assert(stderr.includes('Press Ctrl+C to stop'), 'Should show stop message');

  // Update the trigger file to fire the watcher callback
  fs.writeFileSync(triggerFile, `// updated ${Date.now()}\n`);

  // Poll for expected JSON Lines events
  const startTime = Date.now();
  let resultEvent = null;
  while (Date.now() - startTime < 8000) {
    const events = parseJsonLines(stdout);
    resultEvent = events.find((e) => e.event === 'auditFileResult');
    if (resultEvent) break;
    await delay(200);
  }

  // Kill the process
  child.kill();

  await new Promise((resolve) => {
    child.on('exit', resolve);
    child.on('error', resolve);
    setTimeout(resolve, 1500);
  });

  assert(resultEvent, `Should emit auditFileResult event. stdout: ${stdout}`);
  assert(resultEvent.file === relativeTrigger.replace(/\\/g, '/') || resultEvent.file === relativeTrigger, `Result file should match trigger. Got: ${resultEvent.file}`);
  assert(resultEvent.summary && ['low', 'medium', 'high'].includes(resultEvent.summary.severity), 'Should include summary with valid severity');
  assert(resultEvent.impact && Number.isFinite(resultEvent.impact.impactCount), 'Should include impact with finite impactCount');
  assert(resultEvent.affectedTests && Number.isFinite(resultEvent.affectedTests.affectedTestsCount), 'Should include affectedTests with finite affectedTestsCount');
  assert(resultEvent.validationAdvice, 'Should include validationAdvice');

  const events = parseJsonLines(stdout);
  const startEvent = events.find((e) => e.event === 'auditFileStart');
  const completeEvent = events.find((e) => e.event === 'auditFileComplete');
  assert(startEvent, 'Should emit auditFileStart event');
  assert(completeEvent, 'Should emit auditFileComplete event');
}

async function testAuditFileWatchTargetFiltering() {

  const relativeTrigger = path.relative(REPO_ROOT, triggerFile);
  const child = spawn('node', [CLI_PATH, 'audit-file', '--file', relativeTrigger, '--watch', '--json'], {
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

  await waitForStartup(stderr);

  // Write to a different file in the same directory
  const otherFile = path.join(tempDir, 'other.js');
  fs.writeFileSync(otherFile, `// other ${Date.now()}\n`);

  // Wait a bit and verify no auditFileResult for other.js
  await delay(1000);

  const events = parseJsonLines(stdout);
  const resultForOther = events.find((e) => e.event === 'auditFileResult' && e.file && e.file.includes('other'));

  // Kill the process
  child.kill();

  await new Promise((resolve) => {
    child.on('exit', resolve);
    child.on('error', resolve);
    setTimeout(resolve, 1500);
  });

  // We may get zero events because other.js is not the target file;
  // or we may get an event for trigger.js if the watcher fires on directory change.
  // The key assertion is: no auditFileResult for other.js.
  assert(!resultForOther, 'Should not emit auditFileResult for non-target file');
}

async function main() {

  await cleanup();
  await setup();

  try {
    await testAuditFileWatch();
    await cleanup();
    await setup();
    await testAuditFileWatchTargetFiltering();
  } finally {
    await cleanup();
  }

}

main().catch(async (err) => {
  await cleanup();
  console.error('Test failed:', err.message);
  process.exit(1);
});
