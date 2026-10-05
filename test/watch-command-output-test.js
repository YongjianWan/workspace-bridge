#!/usr/bin/env node
// @fast
// @semantic
/**
 * executeWatchCommand must return the output a command writes after its main process
 * has exited (a child that outlives it still holds the pipes), but must not wait
 * forever for one that never lets go.
 */
const assert = require('assert');
const { executeWatchCommand } = require('../src/cli/watch');

// Parent exits at once; its child inherits stdout and writes `text` after `delayMs`, then lives `lifeMs`.
function entryWithLateChild(text, delayMs, lifeMs) {
  const childCode = `setTimeout(() => process.stdout.write(${JSON.stringify(text)}), ${delayMs}); setTimeout(() => {}, ${lifeMs});`;
  const parentCode = `require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(childCode)}], { detached: true, stdio: ['ignore', 'inherit', 'inherit'] }).unref(); process.stdout.write('EARLY ');`;
  return { name: 'late-child', executable: { command: process.execPath, args: ['-e', parentCode] } };
}

async function main() {
  const late = await executeWatchCommand(entryWithLateChild('LATE', 300, 400), process.cwd(), 20000);
  assert.strictEqual(late.ok, true);
  assert(late.stdout.includes('EARLY') && late.stdout.includes('LATE'),
    `output written after the main process exited must be kept, got ${JSON.stringify(late.stdout)}`);

  const started = Date.now();
  const stuck = await executeWatchCommand(entryWithLateChild('NEVER', 60000, 60000), process.cwd(), 20000);
  assert(Date.now() - started < 15000, 'a child that never closes its pipes must not hang the result');
  assert(stuck.stdout.includes('EARLY'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
