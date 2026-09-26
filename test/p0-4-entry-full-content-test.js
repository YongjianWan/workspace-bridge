// @semantic — P0-4: entry content scan must read the whole file (bounded by the parser cap), not the first 4KB
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { EntryDetector, readScanContent } = require('../src/services/dep-graph/entry-detector');
const { LIMITS } = require('../src/config/constants');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

function padLines(n) {
  return Array.from({ length: n }, (_, i) => `CONST_${i} = "${'x'.repeat(30)}"`).join('\n');
}

function writeScript(dir, name, body) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, body);
  return file;
}

function testMainGuardBeyond4KBIsEntry() {
  const dir = makeTempDir('wb-p0-4-');
  try {
    // ~11KB of preamble → the trailing guard sits well past the old 4KB head-window
    const file = writeScript(
      dir,
      'tool.py',
      `${padLines(300)}\n\ndef main():\n    print(1)\n\nif __name__ == "__main__":\n    main()\n`
    );
    const content = readScanContent(file);
    assert.ok(content, 'readScanContent must return content for files under the cap');
    assert.ok(content.includes('__main__'), 'scan content must reach the trailing __main__ guard');

    const detector = new EntryDetector({ normalizeFilePath: (p) => p });
    assert.strictEqual(
      detector.isKnownEntryFile(file),
      true,
      'a script whose __main__ guard sits past 4KB must be detected as an entry'
    );
  } finally {
    cleanupTempDir(dir);
  }
}

function testMainGuardBeyondOld64KBCapIsEntry() {
  const dir = makeTempDir('wb-p0-4-big-');
  try {
    // ~110KB: above the old ENTRY_FILE_MAX_BYTES (64KB), below the parser cap
    const file = writeScript(
      dir,
      'big_tool.py',
      `${padLines(3000)}\n\ndef main():\n    print(1)\n\nif __name__ == "__main__":\n    main()\n`
    );
    const detector = new EntryDetector({ normalizeFilePath: (p) => p });
    assert.strictEqual(
      detector.isKnownEntryFile(file),
      true,
      'the entry scan must cover everything the parser covers (files above 64KB included)'
    );
  } finally {
    cleanupTempDir(dir);
  }
}

function testAboveParserCapStillSkipped() {
  const dir = makeTempDir('wb-p0-4-huge-');
  try {
    // Perf guard: files the parser skips (zero exports → dead-exports never
    // consults them) stay unread by the entry scan too.
    const file = writeScript(
      dir,
      'huge_tool.py',
      `if __name__ == "__main__":\n    pass\n${'x'.repeat(LIMITS.PARSER_MAX_FILE_BYTES)}`
    );
    assert.strictEqual(
      readScanContent(file),
      null,
      'files above PARSER_MAX_FILE_BYTES must stay unread'
    );
  } finally {
    cleanupTempDir(dir);
  }
}

function testShebangStillEntry() {
  const dir = makeTempDir('wb-p0-4-shebang-');
  try {
    const file = writeScript(dir, 'worker.py', `#!/usr/bin/env python3\n${padLines(300)}\n`);
    const detector = new EntryDetector({ normalizeFilePath: (p) => p });
    assert.strictEqual(detector.isKnownEntryFile(file), true, 'shebang scripts stay entries');
  } finally {
    cleanupTempDir(dir);
  }
}

function testPlainFileNotEntry() {
  const dir = makeTempDir('wb-p0-4-plain-');
  try {
    const file = writeScript(dir, 'library_mod.py', `${padLines(300)}\n`);
    const detector = new EntryDetector({ normalizeFilePath: (p) => p });
    assert.strictEqual(
      detector.isKnownEntryFile(file),
      false,
      'a plain module without entry signals must not become an entry'
    );
  } finally {
    cleanupTempDir(dir);
  }
}

function run() {
  testMainGuardBeyond4KBIsEntry();
  testMainGuardBeyondOld64KBCapIsEntry();
  testAboveParserCapStillSkipped();
  testShebangStillEntry();
  testPlainFileNotEntry();
  console.log('PASS: p0-4-entry-full-content-test');
}

run();
