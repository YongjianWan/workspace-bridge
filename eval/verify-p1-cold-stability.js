// @semantic
'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { ServiceContainer } = require('../src/services/container');
const { runCliInProcess } = require('../cli');
const repositories = {
  javascript: ['js-ts', 'zod'], python: ['python', 'typer'], java: ['java', 'spring-petclinic'],
  kotlin: ['kotlin', 'okhttp'], go: ['go', 'cobra'], rust: ['rust', 'ripgrep'],
  cpp: ['c-cpp', 'cJSON'], vue: ['vue', 'vitesse'], svelte: ['svelte', 'realworld'],
};
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-p1-cold-'));
const report = [];
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function main() {
  for (const [language, location] of Object.entries(repositories)) {
    const root = path.join(__dirname, 'truth', 'repos', ...location);
    assert(fs.existsSync(root), `missing corpus: ${root}`);
    const runs = [];
    for (let repeat = 0; repeat < 5; repeat++) {
      const container = new ServiceContainer({ quiet: true, cacheDir: path.join(scratch, `${language}-${repeat}`) });
      try {
        assert(await container.initialize(root, 180000, { watch: false, strictCwd: true }), container.initError?.message);
        const output = await runCliInProcess(['audit-overview', '--cwd', root, '--strict-cwd', '--json', '--quiet'], { container });
        assert.strictEqual(output.status, 0, output.stderr);
        const data = JSON.parse(output.stdout);
        const selected = Object.fromEntries(['skeleton', 'hotspots', 'deadExports', 'unresolved', 'cycles', 'astRules', 'analysisCoverage'].map(key => [key, data[key]]));
        runs.push({ graph: hash(container.snapshot.graph.getAllFilePaths()), output: hash(selected), files: container.snapshot.graph.getFileCount() });
      } finally { await container.shutdown(); }
    }
    const stable = runs.every(run => run.graph === runs[0].graph && run.output === runs[0].output);
    report.push({ language, stable, runs });
    console.log(JSON.stringify(report.at(-1)));
    fs.writeFileSync(path.join(__dirname, 'truth', 'p1-cold-stability.json'), JSON.stringify(report, null, 2));
    assert(stable, `${language}: cold outputs differ`);
  }
  console.log('cold stability: 9/9 languages, 45/45 cold runs passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
