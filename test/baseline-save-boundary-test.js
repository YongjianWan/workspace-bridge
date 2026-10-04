// @semantic
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { applyBaselineOperations } = require('../src/tools/regression-tools');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

const root = makeTempDir('wb-save-boundary-');
const outside = makeTempDir('wb-save-outside-');
const result = () => ({ ok: true, workspaceRoot: root });
const save = (name) => applyBaselineOperations(result(), { cwd: root, save: name });
let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`OK ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.message}`); }
}
try {
  const sentinel = path.join(outside, 'keep.json');
  const original = '{"keep":"untouched"}';
  fs.writeFileSync(sentinel, original);
  check('absolute outside path is rejected without overwriting', () => {
    assert.throws(() => save(sentinel), /workspace/i);
    assert.strictEqual(fs.readFileSync(sentinel, 'utf8'), original);
  });
  fs.writeFileSync(sentinel, original);
  check('relative traversal is rejected without overwriting', () => {
    assert.throws(() => save(path.relative(root, sentinel)), /workspace/i);
    assert.strictEqual(fs.readFileSync(sentinel, 'utf8'), original);
  });
  check('new outside path is not created', () => {
    const target = path.join(outside, 'new.json');
    assert.throws(() => save(target), /workspace/i);
    assert.strictEqual(fs.existsSync(target), false);
  });
  check('ordinary workspace file is not overwritten', () => {
    const target = path.join(root, 'source.json');
    fs.writeFileSync(target, original);
    assert.throws(() => save(target), /baseline|overwrite/i);
    assert.strictEqual(fs.readFileSync(target, 'utf8'), original);
  });
  check('malformed baseline is not overwritten', () => {
    const target = path.join(root, 'malformed.json');
    const text = JSON.stringify({ schemaVersion: '1.2.0', findings: {} });
    fs.writeFileSync(target, text);
    assert.throws(() => save(target), /baseline|overwrite/i);
    assert.strictEqual(fs.readFileSync(target, 'utf8'), text);
  });
  check('directory symlink or junction cannot escape workspace', () => {
    const link = path.join(root, 'linked');
    fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    fs.writeFileSync(sentinel, original);
    assert.throws(() => save(path.join(link, 'keep.json')), /workspace/i);
    assert.strictEqual(fs.readFileSync(sentinel, 'utf8'), original);
  });
  check('hardlinked baseline cannot overwrite another file', () => {
    const baseline = path.join(root, 'hardlink-source.json');
    save(baseline);
    const originalBaseline = fs.readFileSync(baseline, 'utf8');
    const link = path.join(root, 'hardlink.json');
    fs.linkSync(baseline, link);
    assert.throws(() => save(link), /link|overwrite/i);
    assert.strictEqual(fs.readFileSync(baseline, 'utf8'), originalBaseline);
  });
  if (process.platform !== 'win32') check('file symlink is rejected', () => {
    const target = path.join(root, 'real.json');
    save(target);
    const text = fs.readFileSync(target, 'utf8');
    const link = path.join(root, 'file-link.json');
    fs.symlinkSync(target, link);
    assert.throws(() => save(link), /link|overwrite/i);
    assert.strictEqual(fs.readFileSync(target, 'utf8'), text);
  });
  check('default and explicit in-workspace baselines can be updated', () => {
    save(true);
    save(true);
    const target = path.join(root, 'baseline.json');
    save(target);
    const updated = { ok: true, workspaceRoot: root, deadExports: { deadExports: [{ file: 'a.js', name: 'unused' }] } };
    applyBaselineOperations(updated, { cwd: root, save: target });
    assert.strictEqual(updated.baselineSaved, target);
    assert.strictEqual(JSON.parse(fs.readFileSync(target)).findings.deadExports[0].name, 'unused');
    // A shorter replacement must truncate the previous JSON, including legacy BOM files.
    fs.writeFileSync(target, '\ufeff' + fs.readFileSync(target, 'utf8'));
    save(target);
    assert.strictEqual(JSON.parse(fs.readFileSync(target, 'utf8')).findings.deadExports.length, 0);
  });
} finally {
  cleanupTempDir(root);
  cleanupTempDir(outside);
}
assert.strictEqual(failures, 0, `${failures} save boundary checks failed`);
