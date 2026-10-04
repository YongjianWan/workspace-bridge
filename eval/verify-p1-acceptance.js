// @semantic
'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ServiceContainer } = require('../src/services/container');
const { runCliInProcess } = require('../cli');
const { buildHotspots } = require('../src/tools/overview-assembler');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-p1-accept-'));
const report = [];

async function inspect(group, name, check) {
  const root = path.join(__dirname, 'truth/repos', group, name);
  const container = new ServiceContainer({ quiet: true, cacheDir: path.join(scratch, name) });
  try {
    assert(await container.initialize(root, 180000, { watch: false, strictCwd: true }), container.initError?.message);
    const result = await check(container, root);
    report.push({ repository: name, ...result });
    console.log(JSON.stringify(report.at(-1)));
  } finally { await container.shutdown(); }
}

async function main() {
  await inspect('python', 'django', async (container, root) => {
    const graph = container.snapshot.graph;
    const files = graph.getAllFilePaths().filter(file => !graph.isTestLikeFile(file));
    const seen = [];
    const history = async (_root, file) => { seen.push(file); return { ok: true, score: 0 }; };
    const first = await buildHotspots(root, graph, files, history);
    const second = await buildHotspots(root, graph, [...files].reverse(), history);
    assert.deepStrictEqual(first, second, 'hotspots depend on input order');
    const candidates = seen.slice(0, seen.length / 2).map(file => path.relative(root, file).replace(/\\/g, '/'));
    assert(candidates.some(file => file.startsWith('django/db/models/')), 'model core absent from ranked candidates');
    return { candidates, orderIndependent: true };
  });
  await inspect('python', 'typer', async (container, root) => {
    const dependencies = container.snapshot.graph.getDependencies(path.join(root, 'typer/testing.py'));
    for (const module of ['_compat', 'formatting', 'termui', 'utils']) {
      assert(dependencies.some(file => file.endsWith(`/typer/_click/${module}.py`)), `missing ${module}`);
    }
    return { testingDependencies: dependencies.map(file => path.relative(root, file).replace(/\\/g, '/')) };
  });
  for (const [group, name] of [['js-ts', 'bulletproof-react'], ['js-ts', 'zod'], ['rust', 'ripgrep'], ['c-cpp', 'fmt']]) {
    await inspect(group, name, async (container, root) => {
      const result = await runCliInProcess(['dead-exports', '--cwd', root, '--strict-cwd', '--json', '--quiet'], { container });
      assert.strictEqual(result.status, 0, result.stderr);
      const data = JSON.parse(result.stdout);
      const unsafe = JSON.stringify(data).match(/"safeToDelete":true/g) || [];
      assert.strictEqual(unsafe.length, 0);
      return { safeToDeleteTrue: unsafe.length };
    });
  }
  fs.writeFileSync(path.join(__dirname, 'truth/p1-acceptance.json'), JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
