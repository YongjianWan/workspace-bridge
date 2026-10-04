// @semantic
const assert = require('assert');
const { parseCliArgs } = require('../src/cli/validate-args');
const { formatCliResult } = require('../src/cli/route-formatter');
const guard = require('../src/cli/commands/guard');
const { dependencyGraph } = require('../src/tools/dep-tools');

async function main() {
  let failed = 0;
  const checks = [
    ['unindexed structural target', async () => {
      const graph = { hasFile: () => false, getDependents: () => [], _displayPath: value => value };
      const result = await dependencyGraph({ operation: 'dependents', file: 'README.md' },
        { ensureReady: async () => {}, workspaceRoot: __dirname, snapshot: { graph } });
      assert(result.warnings.some(w => w.type === 'target-not-indexed'));
      assert.strictEqual(result.dataQuality, 'degraded');
      assert.strictEqual(result.hasFindings, true);
    }],
    ['missing exclude value', () => assert.throws(() => parseCliArgs(['node', 'cli.js', 'audit-overview', '--exclude']))],
    ['unsupported language', () => assert.throws(() => parseCliArgs(['node', 'cli.js', 'audit-security', '--language', 'cobol']))],
    ['unknown fields', () => {
      const result = { ok: true, hotspots: [] };
      formatCliResult({ command: 'audit-overview', json: true, fields: 'nonexist' }, result);
      assert(result.warnings.some(w => w.type === 'unknown-fields'));
    }],
    ['guard missing target', async () => {
      const result = await guard({ files: 'absent.js' }, { ensureReady: async () => {}, workspaceRoot: __dirname,
        depGraph: { _displayPath: value => value } });
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.passed, false);
      assert(result.warnings.some(w => w.type === 'missing-target'));
    }],
  ];
  for (const [name, check] of checks) {
    try { await check(); console.log(`PASS ${name}`); }
    catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`); }
  }
  console.log(`CLI trust contracts: ${checks.length - failed}/${checks.length} passed`);
  assert.strictEqual(failed, 0);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
