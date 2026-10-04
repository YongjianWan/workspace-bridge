// @semantic
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { FileIndex } = require('../src/services/file-index');
const { WorkspaceCache } = require('../src/services/cache');
const { DependencyGraph } = require('../src/services/dep-graph');
const { formatAuditSummary, formatAi } = require('../src/cli/formatters/human-formatters');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

async function main() {
  const root = makeTempDir('wb-signals-');
  const cache = new WorkspaceCache(root, { cacheDir: path.join(root, '.cache') });
  let failed = 0;
  async function check(name, fn) {
    try { await fn(); console.log(`PASS ${name}`); }
    catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`); }
  }
  try {
    await check('index timeout reports incomplete discovery', async () => {
      const index = new FileIndex(root, cache, { quiet: true });
      index.findFilesAsync = async function* () { await new Promise(resolve => setTimeout(resolve, 20)); yield path.join(root, 'a.js'); };
      await index.build(1, { watch: false });
      assert(index.ledger.warnings().some(w => w.type === 'index-timeout'));
      const graph = DependencyGraph.fromSchema(root, {});
      graph.ledger = index.ledger;
      const coverage = graph.getStats().analysisCoverage;
      assert.strictEqual(coverage.coverageRatio, null);
      const result = { ok: true, summary: { analysisCoverage: coverage }, scope: {} };
      assert(formatAuditSummary(result, 'summary').includes('unknown'), 'unknown discovery coverage must not render as measured 0%');
      const digest = JSON.parse(formatAi('audit-summary', result));
      assert.strictEqual(digest.confidence.coverageRatio, null, 'AI output must not default unknown coverage to 100%');
    });
    await check('cache write failures are visible', async () => {
      cache._graphDb.saveIncremental = () => { throw Error('disk full'); };
      cache.dirty = true;
      assert.strictEqual(await cache.save(), false);
      assert(cache.warnings.some(w => w.type === 'cache-write-failed'));
    });
    await check('oversize and unsupported encoding have warnings', async () => {
      fs.writeFileSync(path.join(root, 'large.js'), ' '.repeat(1024 * 1024 + 1));
      fs.writeFileSync(path.join(root, 'utf16.py'), Buffer.from('from pkg import helper\n', 'utf16le'));
      const graph = new DependencyGraph(root, cache, { quiet: true });
      await graph.build([path.join(root, 'large.js'), path.join(root, 'utf16.py')]);
      const warnings = graph.buildWarnings();
      assert(warnings.some(w => w.type === 'file-too-large'));
      assert(warnings.some(w => w.type === 'unsupported-source-encoding'));
      assert.strictEqual(graph.getStats().analysisCoverage.parsedFiles, 0);
    });
    await check('analysis listener failures remain observable', async () => {
      fs.writeFileSync(path.join(root, 'a.js'), 'export const a = 1;');
      const graph = new DependencyGraph(root, cache, { quiet: true });
      graph.analyzer.precomputeAggregates = async () => { throw Error('injected analysis failure'); };
      await graph.build([path.join(root, 'a.js')]);
      assert(graph.buildWarnings().some(w => w.type === 'analysis-stage-failed' && w.stage === 'graph:built'));
    });
    console.log(`failure signals: ${4 - failed}/4 passed`);
    assert.strictEqual(failed, 0);
  } finally { cache.close(); cleanupTempDir(root); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
