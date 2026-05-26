// @contract — Wave 2 参数与边界修复验证
// @slow
const assert = require('assert');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CLI = path.join(__dirname, '..', 'cli.js');
const CWD = path.join(__dirname, '..');

function run(args) {
  const cmd = `node "${CLI}" ${args}`;
  try {
    const out = execSync(cmd, { cwd: CWD, encoding: 'utf8', stdio: 'pipe' });
    return { code: 0, stdout: out, stderr: '' };
  } catch (err) {
    return { code: err.status || 1, stdout: err.stdout || '', stderr: err.stderr || '' };
  }
}

function runJson(args) {
  const r = run(args);
  try {
    r.json = JSON.parse(r.stdout);
  } catch {
    r.json = null;
  }
  return r;
}

// W2-1: --strict-cwd must prevent escaping to git root
{
  const r = runJson('workspace-info --cwd reference --strict-cwd --json --quiet');
  assert.strictEqual(r.json?.ok, true, 'W2-1: workspace-info should succeed');
  const root = r.json?.workspaceRoot;
  assert.ok(root?.includes('reference') || root?.endsWith('reference'), `W2-1: workspaceRoot should stay in reference/, got: ${root}`);
}

// W2-2: --exclude glob patterns must work
{
  const r = runJson('audit-summary --exclude "src/**" --json --quiet');
  assert.strictEqual(r.json?.ok, true, 'W2-2: exclude glob should succeed');
  assert.ok(r.json?.scope?.counts?.mainlineFiles < 50, `W2-2: src/** should exclude most src files, got mainlineFiles: ${r.json?.scope?.counts?.mainlineFiles}`);
}

// W2-3: audit-file --file must reject directories
{
  const r = runJson('audit-file --file src/services/ --json --quiet');
  assert.strictEqual(r.json?.ok, false, 'W2-3: directory should be rejected');
  assert.ok(r.json?.error?.includes('directory') || r.json?.error?.includes('file'), `W2-3: error should mention directory, got: ${r.json?.error}`);
}

// W2-5: --check-regression must include explicit status
{
  // Baseline must already exist from earlier dogfooding or manual runs
  const r = runJson('audit-summary --check-regression --json --quiet');
  assert.strictEqual(r.json?.ok, true, 'W2-5: check-regression should succeed');
  assert.ok(r.json?.regression?.status === 'clean' || r.json?.regression?.status === 'degraded', `W2-5: regression.status missing, got: ${JSON.stringify(r.json?.regression)}`);
}

// W2-4: empty file must not trigger mention-based severity escalation
{
  const emptyFile = path.join(CWD, 'empty-wave2-test.js');
  fs.writeFileSync(emptyFile, '');
  const r = runJson(`audit-file --file empty-wave2-test.js --json --quiet`);
  fs.unlinkSync(emptyFile);
  assert.strictEqual(r.json?.ok, true, 'W2-4: empty file audit should succeed');
  assert.strictEqual(r.json?.summary?.severity, 'low', `W2-4: empty file severity should be low, got: ${r.json?.summary?.severity}`);
  assert.strictEqual(r.json?.affectedTests?.affectedTestsCount, 0, `W2-4: empty file should have 0 affected tests, got: ${r.json?.affectedTests?.affectedTestsCount}`);
}

// W2-6: --token-budget downgrade must inject downgraded flag (via --format ai --json)
{
  const r = runJson('audit-summary --token-budget 50 --depth full --format ai --json --quiet');
  assert.strictEqual(r.json?.ok, true, 'W2-6: token-budget command should succeed');
  assert.strictEqual(r.json?.downgraded, true, 'W2-6: downgraded flag should be true when depth is forced down');
}

console.log('Wave 2 boundary fixes: all assertions passed');
