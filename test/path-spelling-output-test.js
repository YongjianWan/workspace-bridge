#!/usr/bin/env node
// @slow
// @semantic
/**
 * Output carries one spelling per path: a file or directory that appears anywhere in a result is
 * written as it is on disk (never the case-folded graph key), in the style the field uses
 * (absolute stays absolute, workspace-relative stays relative with `/`).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeTempDir, cleanupTempDir, runCli } = require('./test-helpers');
const { applyPathSpelling } = require('../src/cli/path-spelling');

// Unit: exact keys are respelled, nothing else is touched, an empty index is free.
{
  const index = new Map([['c:/w/src/a.js', 'C:/W/Src/A.js'], ['src/a.js', 'Src/A.js']]);
  const out = applyPathSpelling({ file: 'c:/w/src/a.js', rel: 'src/a.js', note: 'see src/a.js now', n: 1, none: null, list: ['src/a.js'], 'src/a.js': 1 }, index);
  assert.deepStrictEqual(out, { file: 'C:/W/Src/A.js', rel: 'Src/A.js', note: 'see src/a.js now', n: 1, none: null, list: ['Src/A.js'], 'Src/A.js': 1 });
  const same = { file: 'x' };
  assert.strictEqual(applyPathSpelling(same, new Map()), same);
}

// Graph keys fold case only on Windows; elsewhere `src/main.js` and `Src/Main.js` are different
// files, so a lowercase string in a result is not a respelling candidate.
if (process.platform !== 'win32') {
  console.log('skipped end-to-end part: case folding is a Windows behaviour');
  process.exit(0);
}

const root = makeTempDir('wb-spelling-');
try {
  fs.mkdirSync(path.join(root, 'Src', 'Core'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"x"}\n');
  fs.writeFileSync(path.join(root, 'Src', 'Main.js'), "module.exports = require('./Core/Util');\n");
  fs.writeFileSync(path.join(root, 'Src', 'Core', 'Util.js'), 'module.exports = 1;\n');

  const realRoot = fs.realpathSync(root);
  const files = ['Src/Main.js', 'Src/Core/Util.js', 'Src/Core', 'Src'];
  const spellings = new Map();
  for (const rel of files) {
    spellings.set(rel.toLowerCase(), rel);
    spellings.set(path.join(realRoot, rel).split(path.sep).join('/').toLowerCase(), path.join(realRoot, rel));
  }

  const base = ['--cwd', root, '--cache-dir', path.join(root, '.cache-out'), '--json', '--quiet'];
  const commands = [['impact', '--file', 'Src/Core/Util.js'], ['dependents', '--file', 'Src/Core/Util.js'], ['audit-overview'], ['audit-map']];
  for (const command of commands) {
    const strings = [];
    const walk = (v) => {
      if (typeof v === 'string') strings.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') for (const [k, c] of Object.entries(v)) { strings.push(k); walk(c); }
    };
    walk(runCli([...command, ...base]));
    for (const s of strings) {
      const folded = s.split(path.sep).join('/').toLowerCase();
      const spelled = spellings.get(folded);
      if (!spelled) continue;
      // Absolute paths keep the caller's root spelling, which may differ from the real one by
      // symlinks; compare the part below the workspace root.
      const tail = (p) => p.split(path.sep).join('/').split('/').slice(-spelled.split('/').length).join('/');
      assert.strictEqual(tail(s), tail(spelled), `${command[0]}: "${s}" is not written as on disk ("${spelled}")`);
    }
  }
} finally {
  cleanupTempDir(root);
}
