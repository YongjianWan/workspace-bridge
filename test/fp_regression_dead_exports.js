// @semantic
// @slow
// Regression archive for known dead-exports false-positive scenarios.
// If a previously-fixed FP recurs, this test fails.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { runCliInProcessRaw, makeTempDir, cleanupTempDir } = require('./test-helpers');

const tempDir = makeTempDir('wb-fp-de-');

// ---fixture setup-------------------------------------------------------------
fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });
fs.writeFileSync(
  path.join(tempDir, 'package.json'),
  JSON.stringify({ name: 'fp-de', version: '1.0.0' }),
  'utf8'
);

// 1) Vue compiler macros inside .vue must NOT be dead-export
fs.writeFileSync(
  path.join(tempDir, 'src', 'Button.vue'),
  `<script setup>
import { defineProps, defineEmits } from 'vue';
export { defineProps, defineEmits };
export const helper = 'ok';
</script>
`,
  'utf8'
);

// 2) Explicit Vue macro re-export from .ts must NOT be dead-export
fs.writeFileSync(
  path.join(tempDir, 'src', 'macroBridge.ts'),
  `export { defineProps, defineEmits } from 'vue';\n`,
  'utf8'
);

// 3) Barrel re-export must NOT be dead-export when consumed via the barrel
fs.writeFileSync(
  path.join(tempDir, 'src', 'barrel.js'),
  `export { helper } from './helper.js';\n`,
  'utf8'
);
fs.writeFileSync(
  path.join(tempDir, 'src', 'helper.js'),
  `export const helper = 1;\nexport const unusedHelper = 2;\n`,
  'utf8'
);
fs.writeFileSync(
  path.join(tempDir, 'src', 'consumer.js'),
  `import { helper } from './barrel.js';\nconsole.log(helper);\n`,
  'utf8'
);

// 4) Truly unused export in src/ — MUST still be detected
fs.writeFileSync(
  path.join(tempDir, 'src', 'realUnused.js'),
  `export const totallyUnused = 42;\n`,
  'utf8'
);

// ---helpers-----------------------------------------------------------------
async function runDeadExports(cwd) {
  return await runCliInProcessRaw(['dead-exports', '--cwd', cwd, '--json', '--quiet'], { cwd });
}

function parseJsonSafe(result) {
  let stdout = result.stdout;
  if (stdout && stdout.startsWith('\ufeff')) stdout = stdout.slice(1);
  return JSON.parse(stdout);
}

// ---tests-------------------------------------------------------------------
async function testVueMacroNotDeadExport() {
  const result = await runDeadExports(tempDir);
  assert.strictEqual(result.status, 0, `CLI failed: ${result.stderr}`);
  const data = parseJsonSafe(result);

  const vueItem = data.deadExports.find((d) =>
    d.file && d.file.includes('Button.vue')
  );
  assert.strictEqual(
    vueItem,
    undefined,
    `Vue compiler macros in .vue must NOT be dead-export, got: ${JSON.stringify(vueItem)}`
  );
}

async function testExplicitVueMacroReExportNotDeadExport() {
  const result = await runDeadExports(tempDir);
  assert.strictEqual(result.status, 0, `CLI failed: ${result.stderr}`);
  const data = parseJsonSafe(result);

  const tsItem = data.deadExports.find((d) =>
    d.file && d.file.includes('macroBridge.ts')
  );
  assert.strictEqual(
    tsItem,
    undefined,
    `Explicit Vue macro re-export from .ts must NOT be dead-export, got: ${JSON.stringify(tsItem)}`
  );
}

async function testBarrelReExportNotDeadExport() {
  const result = await runDeadExports(tempDir);
  assert.strictEqual(result.status, 0, `CLI failed: ${result.stderr}`);
  const data = parseJsonSafe(result);

  // barrel.js is imported by consumer.js, so it should not be dead-export
  const barrelItem = data.deadExports.find((d) =>
    d.file && d.file.includes('barrel.js')
  );
  assert.strictEqual(
    barrelItem,
    undefined,
    `Barrel re-export imported by consumer must NOT be dead-export, got: ${JSON.stringify(barrelItem)}`
  );

  // helper.js's 'helper' is consumed via barrel, so it should not be dead-export
  const helperItem = data.deadExports.find((d) =>
    d.file && d.file.includes('helper.js')
  );
  if (helperItem) {
    assert.ok(
      !helperItem.exports.includes('helper'),
      `helper.js 'helper' consumed via barrel must NOT be dead-export, got: ${JSON.stringify(helperItem)}`
    );
  }
}

async function testRealUnusedStillDetected() {
  const result = await runDeadExports(tempDir);
  assert.strictEqual(result.status, 0, `CLI failed: ${result.stderr}`);
  const data = parseJsonSafe(result);

  const unusedItem = data.deadExports.find((d) =>
    d.file && d.file.includes('realUnused.js')
  );
  assert.ok(
    unusedItem,
    `Truly unused export in src/realUnused.js must still be detected`
  );
  assert.ok(
    unusedItem.exports.includes('totallyUnused'),
    `realUnused.js should list 'totallyUnused' as dead export`
  );
}

async function testDeadExportCountConsistent() {
  const result = await runDeadExports(tempDir);
  assert.strictEqual(result.status, 0, `CLI failed: ${result.stderr}`);
  const data = parseJsonSafe(result);

  // We expect exactly 1 dead-export file (realUnused.js) and zero FPs
  const fpFiles = ['Button.vue', 'macroBridge.ts', 'barrel.js', 'consumer.js'];
  const fpCount = data.deadExports.filter((d) =>
    fpFiles.some((f) => d.file && d.file.includes(f))
  ).length;
  assert.strictEqual(
    fpCount,
    0,
    `expected 0 false-positive dead exports, got ${fpCount}: ${JSON.stringify(data.deadExports.map((d) => d.file))}`
  );

  const realCount = data.deadExports.filter((d) =>
    d.file && d.file.includes('realUnused.js')
  ).length;
  assert.strictEqual(
    realCount,
    1,
    `expected 1 true dead-export (realUnused.js), got ${realCount}`
  );
}

// ---main--------------------------------------------------------------------
async function main() {
  try {
    await testVueMacroNotDeadExport();
    await testExplicitVueMacroReExportNotDeadExport();
    await testBarrelReExportNotDeadExport();
    await testRealUnusedStillDetected();
    await testDeadExportCountConsistent();
  } finally {
    cleanupTempDir(tempDir);
  }
}

main();
