// @semantic — Frozen probes injected into independent copies of fixed real repositories.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ServiceContainer } = require('../src/services/container');
const matrix = require('./truth/u22-graph-matrix.json');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-fixed-injection-'));
const repositories = {
  javascript: ['js-ts', 'execa'], typescript: ['js-ts', 'zod'], python: ['python', 'typer'], java: ['java', 'spring-petclinic'], kotlin: ['kotlin', 'okhttp'], go: ['go', 'cobra'], cpp: ['c-cpp', 'cJSON'], vue: ['vue', 'vitesse'], svelte: ['svelte', 'realworld'], rust: ['rust', 'ripgrep'],
};
const report = [];
function git(dir, args) {
  const run = spawnSync('git', args, { cwd: dir, encoding: 'utf8', timeout: 60000 });
  if (run.status !== 0) throw new Error(run.stderr);
  return run.stdout.trim();
}
(async () => {
  for (const [lang, [folder, name]] of Object.entries(repositories)) {
    if (process.argv[2] && !process.argv[2].split(',').includes(lang)) continue;
    const source = path.join(__dirname, 'truth/repos', folder, name);
    if (!fs.existsSync(source)) { report.push({ lang, missingRepository: source }); console.log(JSON.stringify(report.at(-1))); continue; }
    const commit = git(source, ['rev-parse', 'HEAD']);
    const dir = path.join(scratch, lang);
    git(scratch, ['clone', '--shared', '--quiet', source, dir]);
    const probe = path.join(dir, 'truth_probe');
    fs.cpSync(path.join(matrix.scratch, lang), probe, { recursive: true });
    let moduleName;
    if (lang === 'go') {
      moduleName = fs.readFileSync(path.join(dir, 'go.mod'), 'utf8').match(/^module\s+(\S+)/m)[1];
      fs.rmSync(path.join(probe, 'go.mod'));
      for (const name of ['a', 'b', 'c', 'driver']) {
        const file = path.join(probe, name, `${name}.go`);
        fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replaceAll('example.com/truth/', `${moduleName}/truth_probe/`));
      }
    }
    if (lang === 'python') for (const name of ['a', 'b', 'c', 'driver']) {
      const file = path.join(probe, `${name}.py`);
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^import ([abc])$/gm, 'import truth_probe.$1'));
    }
    if (lang === 'rust') fs.appendFileSync(path.join(probe, 'Cargo.toml'), '\n[workspace]\n');
    if (lang === 'javascript') for (const name of ['a', 'b', 'c', 'driver']) {
      const file = path.join(probe, `${name}.js`);
      const text = fs.readFileSync(file, 'utf8').replace(/const ([abc]) = require\('\.\/([abc])'\);/g, "import $1 from './$2.js';").replace('module.exports = () => 1;', 'export default () => 1;');
      fs.writeFileSync(file, text);
    }
    const container = new ServiceContainer({ quiet: true, cacheDir: path.join(scratch, `cache-${lang}`) });
    try {
      const initialized = await container.initialize(dir, 180000, { watch: false, strictCwd: true });
      if (!initialized) throw container.initError || new Error('Initialization failed');
      const graph = container.snapshot.graph;
      const fixture = matrix.cases.find((item) => item.lang === lang);
      const expected = fixture.expected;
      const files = [...new Set(expected.flatMap((edge) => edge.split(' -> ')))];
      const relative = (file) => path.relative(probe, graph._displayPath?.(file) || file).replaceAll('\\', '/');
      const actual = files.flatMap((file) => graph.getDependencies(path.join(probe, file)).map((target) => `${file} -> ${relative(target)}`));
      const missing = expected.filter((edge) => !actual.includes(edge));
      const extra = actual.filter((edge) => !expected.includes(edge));
      const target = fixture.expectedCycleMembers.find((file) => path.basename(file).startsWith('c.')) || 'c/c.go';
      const impact = graph.getImpactRadius(path.join(probe, target), 10).map((item) => relative(item.file)).sort();
      const cycles = graph.findCircularDependencies().filter((cycle) => cycle.some((file) => graph._displayPath(file).startsWith(probe)));
      report.push({ lang, repository: name, commit, moduleName, expected, actual, missing, extra, impact, expectedImpact: fixture.expectedImpact, cycles, cycleMeta: graph.getCycleMeta(), precision: actual.length ? (actual.length - extra.length) / actual.length : 0, recall: (expected.length - missing.length) / expected.length });
    } catch (error) { report.push({ lang, repository: name, commit, error: error.stack }); }
    finally { await container.shutdown(); }
    console.log(JSON.stringify(report.at(-1)));
    const output = process.argv[2] ? 'u22-fixed-injection-selected.json' : 'u22-fixed-injection.json';
    fs.writeFileSync(path.join(__dirname, 'truth', output), JSON.stringify({ scope: 'Same frozen probe in committed real-repository copies; measures probe accuracy under real resolution/configuration, not full-repo precision/recall', cases: report }, null, 2) + '\n');
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
