// @contract
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { runCliInProcessRaw, makeTempDir, cleanupTempDir } = require('./test-helpers');

function writeFile(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

async function run(args, cwd) {
  return await runCliInProcessRaw(args, { cwd, timeout: 30000 });
}

async function testSingleFileGuard() {
  const tempRoot = makeTempDir('wb-guard-single-');
  try {
    writeFile(tempRoot, 'package.json', JSON.stringify({ name: 'guard-single', version: '1.0.0' }, null, 2));
    writeFile(tempRoot, 'src/d.js', 'export const d = 1;\n');
    writeFile(tempRoot, 'src/c.js', 'import { d } from "./d"; export const c = d + 1;\n');
    writeFile(tempRoot, 'src/b.js', 'import { c } from "./c"; export const b = c + 1;\n');
    writeFile(tempRoot, 'src/a.js', 'import { b } from "./b"; export const a = b + 1;\n');

    // 1. Within limits: direct = 1 (limit 2), transitive = 3 (limit 4)
    const resOk = await run(['guard', '--file', 'src/d.js', '--max-dependents', '2', '--max-transitive', '4', '--json', '--quiet'], tempRoot);
    assert.strictEqual(resOk.status, 0, `Within limits should return exit status 0. stderr: ${resOk.stderr}`);
    const dataOk = JSON.parse(resOk.stdout);
    assert.strictEqual(dataOk.ok, true);
    assert.strictEqual(dataOk.passed, true);
    assert.strictEqual(dataOk.stats.directDependentsCount, 1);
    assert.strictEqual(dataOk.stats.transitiveDependentsCount, 3);
    assert.deepStrictEqual(dataOk.exceeded, []);

    // 2. Exceed direct limit: direct = 1 (limit 0), transitive = 3 (limit 4)
    const resDirectExceeded = await run(['guard', '--file', 'src/d.js', '--max-dependents', '0', '--max-transitive', '4', '--json', '--quiet'], tempRoot);
    assert.strictEqual(resDirectExceeded.status, 1, 'Exceeded direct dependents limit should return exit status 1');
    const dataDirect = JSON.parse(resDirectExceeded.stdout);
    assert.strictEqual(dataDirect.ok, true);
    assert.strictEqual(dataDirect.passed, false);
    assert.deepStrictEqual(dataDirect.exceeded, ['direct']);

    // 3. Exceed transitive limit: direct = 1 (limit 2), transitive = 3 (limit 2)
    const resTransitiveExceeded = await run(['guard', '--file', 'src/d.js', '--max-dependents', '2', '--max-transitive', '2', '--json', '--quiet'], tempRoot);
    assert.strictEqual(resTransitiveExceeded.status, 1, 'Exceeded transitive dependents limit should return exit status 1');
    const dataTransitive = JSON.parse(resTransitiveExceeded.stdout);
    assert.strictEqual(dataTransitive.ok, true);
    assert.strictEqual(dataTransitive.passed, false);
    assert.deepStrictEqual(dataTransitive.exceeded, ['transitive']);
  } finally {
    cleanupTempDir(tempRoot);
  }
}

async function testMultiFileGuardUnion() {
  const tempRoot = makeTempDir('wb-guard-multi-');
  try {
    writeFile(tempRoot, 'package.json', JSON.stringify({ name: 'guard-multi', version: '1.0.0' }, null, 2));
    writeFile(tempRoot, 'src/c.js', 'export const c = 1;\n');
    writeFile(tempRoot, 'src/b.js', 'import { c } from "./c"; export const b = 2;\n');
    writeFile(tempRoot, 'src/a.js', 'import { b } from "./b"; import { c } from "./c"; export const a = 3;\n');

    // Dependencies:
    // a.js imports b.js and c.js
    // b.js imports c.js
    //
    // For b.js:
    //   direct dependents: a.js (1)
    //   transitive: a.js (1)
    // For c.js:
    //   direct dependents: a.js, b.js (2)
    //   transitive: a.js, b.js (2)
    //
    // Union of b.js and c.js:
    //   direct: a.js, b.js (2)
    //   transitive: a.js, b.js (2)

    const resOk = await run(['guard', '--files', 'src/b.js,src/c.js', '--max-dependents', '2', '--max-transitive', '2', '--json', '--quiet'], tempRoot);
    assert.strictEqual(resOk.status, 0);
    const dataOk = JSON.parse(resOk.stdout);
    assert.strictEqual(dataOk.passed, true);
    assert.strictEqual(dataOk.stats.directDependentsCount, 2);
    assert.strictEqual(dataOk.stats.transitiveDependentsCount, 2);

    const resFail = await run(['guard', '--files', 'src/b.js,src/c.js', '--max-dependents', '1', '--max-transitive', '2', '--json', '--quiet'], tempRoot);
    assert.strictEqual(resFail.status, 1);
    const dataFail = JSON.parse(resFail.stdout);
    assert.strictEqual(dataFail.passed, false);
    assert.deepStrictEqual(dataFail.exceeded, ['direct']);
  } finally {
    cleanupTempDir(tempRoot);
  }
}

async function testGuardFormatterOutputs() {
  const tempRoot = makeTempDir('wb-guard-format-');
  try {
    writeFile(tempRoot, 'package.json', JSON.stringify({ name: 'guard-format', version: '1.0.0' }, null, 2));
    writeFile(tempRoot, 'src/b.js', 'export const b = 1;\n');
    writeFile(tempRoot, 'src/a.js', 'import { b } from "./b"; export const a = 2;\n');

    // 0. Test JSON impactItems
    const resJson = await run(['guard', '--file', 'src/b.js', '--max-dependents', '0', '--max-transitive', '0', '--json', '--quiet'], tempRoot);
    assert.strictEqual(resJson.status, 1);
    const dataJson = JSON.parse(resJson.stdout);
    assert.ok(dataJson.impactItems);
    assert.strictEqual(dataJson.impactItems.length, 1);
    const norm = (p) => p.replace(/\\/g, '/');
    assert.ok(norm(dataJson.impactItems[0].file).endsWith('src/a.js'));
    assert.ok(norm(dataJson.impactItems[0].via[0]).endsWith('src/b.js'));

    const normText = (txt) => txt.replace(/\\/g, '/');

    // 1. Test markdown format
    const resMd = await run(['guard', '--file', 'src/b.js', '--max-dependents', '0', '--max-transitive', '0', '--format', 'markdown', '--quiet'], tempRoot);
    assert.strictEqual(resMd.status, 1);
    assert(resMd.stdout.includes('# Modification Guard: BLOCKED'));
    assert(resMd.stdout.includes('[EXCEEDED]'));
    assert(resMd.stdout.includes('### Dependency Blast Radius Map'));
    assert(resMd.stdout.includes('graph TD'));
    assert(normText(resMd.stdout).includes('src/b.js'));
    assert(normText(resMd.stdout).includes('src/a.js'));
    assert(resMd.stdout.includes(' --> '));

    // 2. Test human format
    const resHuman = await run(['guard', '--file', 'src/b.js', '--max-dependents', '0', '--max-transitive', '0', '--format', 'human', '--quiet'], tempRoot);
    assert.strictEqual(resHuman.status, 1);
    assert(resHuman.stdout.includes('Guard Status: BLOCKED'));
    assert(resHuman.stdout.includes('Dependency Blast Radius Tree:'));
    assert(normText(resHuman.stdout).includes('src/b.js'));
    assert(normText(resHuman.stdout).includes('src/a.js'));

    // 3. Test AI format
    const resAi = await run(['guard', '--file', 'src/b.js', '--max-dependents', '0', '--max-transitive', '0', '--format', 'ai', '--quiet'], tempRoot);
    assert.strictEqual(resAi.status, 1);
    assert(resAi.stdout.includes('[Guard Blocked] Modifying') && resAi.stdout.includes('has a transitive impact of 1 files (limit: 0). Review dependents before proceeding.'));

    // 4. Test AI format with only direct exceeded
    const resAiDirect = await run(['guard', '--file', 'src/b.js', '--max-dependents', '0', '--max-transitive', '2', '--format', 'ai', '--quiet'], tempRoot);
    assert.strictEqual(resAiDirect.status, 1);
    assert(resAiDirect.stdout.includes('[Guard Blocked] Modifying') && resAiDirect.stdout.includes('has 1 direct dependents (limit: 0). Review dependents before proceeding.'));
  } finally {
    cleanupTempDir(tempRoot);
  }
}

async function main() {
  await testSingleFileGuard();
  await testMultiFileGuardUnion();
  await testGuardFormatterOutputs();
  console.log('guard-command-test.js: all passed');
}

main();
