#!/usr/bin/env node
// @semantic
// @slow
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { runCliInProcessRaw, makeTempDir, cleanupTempDir } = require('./test-helpers');

function parseJson(result) {
  let stdout = result.stdout;
  if (stdout && stdout.startsWith('\ufeff')) stdout = stdout.slice(1);
  return JSON.parse(stdout);
}

async function runDeadExports(cwd) {
  return await runCliInProcessRaw(['dead-exports', '--cwd', cwd, '--json', '--quiet'], { cwd });
}

function writeFile(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
}

function mapDeadExportsByBaseName(deadExports) {
  const result = new Map();
  for (const item of deadExports || []) {
    result.set(path.basename(item.file), item.exports || []);
  }
  return result;
}

async function main() {
  const tempDir = makeTempDir('wb-dead-export-gt-');
  try {
    writeFile(tempDir, 'package.json', JSON.stringify({ name: 'dead-export-gt', version: '1.0.0' }));

    // JavaScript corpus: one mixed file and one fully unused file.
    writeFile(
      tempDir,
      'src/js/lib.js',
      `export function usedFn() { return 1; }
export function deadFn() { return 2; }
`
    );
    writeFile(
      tempDir,
      'src/js/consumer.js',
      `import { usedFn } from './lib.js';
console.log(usedFn());
`
    );
    writeFile(
      tempDir,
      'src/js/orphan.js',
      `export const orphanValue = 42;
`
    );
    writeFile(
      tempDir,
      'src/js/live.test.js',
      `export const helper = 1;
`
    );

    // JS barrel corpus: used symbols stay live through re-export, while
    // genuinely unused exports remain reportable.
    writeFile(
      tempDir,
      'src/js/barrel.js',
      `export { usedFn } from './lib.js';
`
    );
    writeFile(
      tempDir,
      'src/js/barrel-consumer.js',
      `import { usedFn } from './barrel.js';
console.log(usedFn());
`
    );

    // Rename re-export: the aliased symbol is live because it is imported from
    // a file that is itself consumed.
    writeFile(
      tempDir,
      'src/js/rename-export.js',
      `export { usedFn as renamedFn } from './lib.js';
`
    );
    writeFile(
      tempDir,
      'src/js/rename-consumer.js',
      `import { renamedFn } from './rename-export.js';
console.log(renamedFn());
`
    );

    // Note: `import * as lib from './lib.js'` followed by `lib.usedFn()` is
    // deliberately excluded from this corpus. The current analyzer treats a
    // namespace import as consuming every export of the source module, so it
    // would also mark `deadFn` as live and drop the entire `lib.js` positive.
    // Expanding the corpus to cover precise namespace-usage tracking is a
    // follow-up once that heuristic is refined.

    // Dynamic import: the targeted module's exports are considered live.
    writeFile(
      tempDir,
      'src/js/dynamic-import.js',
      `export const dynamicExp = 1;
`
    );
    writeFile(
      tempDir,
      'src/js/dynamic-consumer.js',
      `import('./dynamic-import.js').then((m) => console.log(m.dynamicExp));
`
    );

    const result = await runDeadExports(tempDir);
    assert.strictEqual(result.status, 0, `CLI failed: ${result.stderr}`);
    const data = parseJson(result);
    const byBaseName = mapDeadExportsByBaseName(data.deadExports);

    const expectedPositives = {
      'lib.js': ['deadFn'],
      'orphan.js': ['orphanValue'],
    };
    const expectedNegatives = [
      'consumer.js',
      'live.test.js',
      'barrel.js',
      'barrel-consumer.js',
      'rename-export.js',
      'rename-consumer.js',
      'dynamic-import.js',
      'dynamic-consumer.js',
    ];

    const expected = {
      ...expectedPositives,
    };

    for (const [baseName, expectedExports] of Object.entries(expected)) {
      assert(byBaseName.has(baseName), `ground-truth corpus should report ${baseName}`);
      assert.deepStrictEqual(
        [...byBaseName.get(baseName)].sort(),
        expectedExports.sort(),
        `${baseName} should report the exact known dead exports`
      );
    }

    for (const baseName of expectedNegatives) {
      assert(!byBaseName.has(baseName), `ground-truth corpus should not report live file ${baseName}`);
    }

    const truePositives = Object.keys(expectedPositives).length;
    const falsePositives = data.deadExports.filter((item) =>
      !Object.prototype.hasOwnProperty.call(expectedPositives, path.basename(item.file))
    ).length;

    assert.strictEqual(
      falsePositives,
      0,
      `ground-truth corpus should not produce extra findings, got: ${JSON.stringify(data.deadExports.map((item) => item.file))}`
    );
    assert.strictEqual(truePositives, 2, 'expected two known dead-export files in the corpus');

    const precision = truePositives / (truePositives + falsePositives || 1);
    const recall = truePositives / (Object.keys(expectedPositives).length || 1);
    assert.strictEqual(precision, 1, `precision should be 1 on the ground-truth corpus, got ${precision}`);
    assert.strictEqual(recall, 1, `recall should be 1 on the ground-truth corpus, got ${recall}`);
  } finally {
    cleanupTempDir(tempDir);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
