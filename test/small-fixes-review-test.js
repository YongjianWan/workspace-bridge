// @semantic
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { sanitizeForRegex, extractImportsWithRegex } = require('../src/services/dep-graph/parsers/js/regex-fallback');
const { readPythonDepsChain } = require('../src/services/dep-graph/resolvers/base');
const { detectPythonTestRunner } = require('../src/utils/stack-detectors/detect');

console.log('--- Testing small bug fixes from code review ---');

// 1. Bug A: regex fallback should support template string import with $ (e.g. $lib/foo)
{
  const code = `
    const a = import(\`$lib/utils\`);
    const b = require(\`$app/stores\`);
  `;
  const sanitized = sanitizeForRegex(code);
  const result = extractImportsWithRegex(sanitized);
  assert.ok(result.imports.includes('$lib/utils'), 'Should extract import(`$lib/utils`)');
  assert.ok(result.imports.includes('$app/stores'), 'Should extract require(`$app/stores`)');
  console.log('OK: regex fallback template string with $');
}

// 2. Bug B: pyproject.toml extras [standard] should not truncate dependency array
{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-pyproject-test-'));
  const pyproject = `
[project]
name = "demo"
dependencies = [
    "fastapi[standard]>=0.115.0",
    "sqlmodel>=0.0.22",
    "uvicorn>=0.30.0",
]
`;
  fs.writeFileSync(path.join(tmpDir, 'pyproject.toml'), pyproject, 'utf8');
  const deps = readPythonDepsChain(tmpDir, tmpDir);
  assert.ok(deps.has('fastapi'), 'Must contain fastapi');
  assert.ok(deps.has('sqlmodel'), 'Must contain sqlmodel after extras [standard]');
  assert.ok(deps.has('uvicorn'), 'Must contain uvicorn');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('OK: pyproject.toml dependencies with extras');
}

// 3. Bug C: detectPythonTestRunner should detect pytest configured in tox.ini
{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-tox-test-'));
  const toxContent = `
[tox]
envlist = py310

[pytest]
addopts = -ra -q
`;
  fs.writeFileSync(path.join(tmpDir, 'tox.ini'), toxContent, 'utf8');
  const runner = detectPythonTestRunner(tmpDir);
  assert.strictEqual(runner, 'pytest', 'Should detect pytest from tox.ini [pytest] section');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('OK: tox.ini pytest detection');
}

// 4. Bug D: tryWorkspacePackage caching
{
  const { tryWorkspacePackage } = require('../src/services/dep-graph/resolvers/javascript');
  const { clearResolverCaches } = require('../src/services/dep-graph/resolvers');
  clearResolverCaches();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-workspace-test-'));
  const pkgJson = {
    workspaces: ['packages/*']
  };
  fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(pkgJson), 'utf8');
  const subPkgDir = path.join(tmpDir, 'packages', 'core');
  fs.mkdirSync(subPkgDir, { recursive: true });
  fs.writeFileSync(path.join(subPkgDir, 'package.json'), JSON.stringify({ name: '@acme/core', main: 'index.js' }), 'utf8');
  fs.writeFileSync(path.join(subPkgDir, 'index.js'), 'module.exports = {};', 'utf8');

  const ctx = {
    root: tmpDir,
    cachedStatSync: (p) => { try { return fs.statSync(p); } catch { return null; } },
    outMeta: {}
  };
  const res1 = tryWorkspacePackage('@acme/core', path.join(tmpDir, 'app.js'), ctx);
  assert.ok(res1 && res1.endsWith('index.js'), 'First resolution should succeed');

  // Delete the subpackage package.json to prove it uses cache on second query
  fs.unlinkSync(path.join(subPkgDir, 'package.json'));
  const res2 = tryWorkspacePackage('@acme/core', path.join(tmpDir, 'app.js'), ctx);
  assert.strictEqual(res2, res1, 'Subsequent resolution must hit in-memory workspace packages cache');

  clearResolverCaches();
  const res3 = tryWorkspacePackage('@acme/core', path.join(tmpDir, 'app.js'), ctx);
  assert.strictEqual(res3, null, 'a new resolve batch must not reuse a deleted package manifest');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('OK: tryWorkspacePackage caching');
}

console.log('All small bug tests passed!');
