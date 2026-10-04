#!/usr/bin/env node
// @semantic — a workspace passed as a Windows 8.3 short path (C:\Users\RUNNER~1\...) must give
// the same results as its long path. GitHub's Windows runners hand out short temp paths, and
// git reports the long form, so a mismatch silently produced "0 changed files".
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { runCliInProcess, makeTempDir, cleanupTempDir } = require('./test-helpers');

function shortPathOf(dir) {
  const script = `(New-Object -ComObject Scripting.FileSystemObject).GetFolder('${dir.replace(/'/g, "''")}').ShortPath`;
  return execFileSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' }).trim();
}

async function main() {
  if (process.platform !== 'win32') {
    console.log('short-path-workspace-test: SKIP (Windows only)');
    return;
  }
  const dir = makeTempDir('wb-short-path-long-name-');
  try {
    const write = (rel, content) => {
      const full = path.join(dir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    };
    write('package.json', '{"name":"short-path"}\n');
    write('src/a.js', 'module.exports = 1;\n');
    write('src/b.js', 'module.exports = require("./a");\n');
    const git = (...args) => spawnSync('git', args, { cwd: dir });
    git('init');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    git('add', '.');
    git('commit', '-m', 'init');
    write('src/a.js', 'module.exports = 2;\n');

    const short = shortPathOf(dir);
    if (short.toLowerCase() === dir.toLowerCase()) {
      console.log('short-path-workspace-test: SKIP (8.3 short names disabled on this volume)');
      return;
    }

    const long = await runCliInProcess(['audit-diff', '--cwd', dir, '--json', '--quiet']);
    const viaShort = await runCliInProcess(['audit-diff', '--cwd', short, '--json', '--quiet']);
    assert.strictEqual(long.summary.counts.changedFiles, 1, 'precondition: the long path sees the edit');
    assert.strictEqual(viaShort.summary.counts.changedFiles, 1, `short path ${short} must see the same edit`);
    console.log('short-path-workspace-test: OK');
  } finally {
    cleanupTempDir(dir);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
