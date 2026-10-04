// @semantic — Python runtime confirms every named submodule; compare CLI edges and impact.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-python-import-truth-'));
if (path.dirname(path.resolve(scratch)) !== path.resolve(os.tmpdir())) throw new Error('Unsafe scratch');
function run(command, args) {
  const result = spawnSync(command, args, { cwd: scratch, encoding: 'utf8', timeout: 120000,
    env: { ...process.env, WB_CACHE_DIR: path.join(scratch, 'cache') } });
  if (result.error || result.status !== 0) throw new Error(result.error || result.stderr || result.stdout);
  return result.stdout;
}
function cli(command, args = []) {
  return JSON.parse(run(process.execPath, [path.join(root, 'cli.js'), command,
    '--cwd', scratch, ...args, '--json', '--quiet']).replace(/^\uFEFF/, ''));
}
try {
  const sources = {
    'pkg/__init__.py': '', 'pkg/a.py': 'value = 1\n', 'pkg/b.py': 'value = 2\n',
    'ns/a.py': 'value = 1\n', 'ns/b.py': 'value = 2\n',
    'regular.py': 'from pkg import a, b\nassert a.value + b.value == 3\n',
    'namespace.py': 'from ns import a, b\nassert a.value + b.value == 3\n',
    'pkg/local.py': 'from . import a, b\nassert a.value + b.value == 3\n',
  };
  for (const [file, content] of Object.entries(sources)) {
    fs.mkdirSync(path.dirname(path.join(scratch, file)), { recursive: true });
    fs.writeFileSync(path.join(scratch, file), content);
  }
  const imported = JSON.parse(run('python', ['-c',
    'import regular, namespace, pkg.local, sys, json; print(json.dumps(sorted(n for n in sys.modules if n in ["pkg.a", "pkg.b", "ns.a", "ns.b"])))']));
  const expectedModules = ['ns.a', 'ns.b', 'pkg.a', 'pkg.b'];
  if (JSON.stringify(imported) !== JSON.stringify(expectedModules)) throw new Error('Runtime oracle mismatch');
  const expected = [['regular.py', 'pkg/a.py'], ['regular.py', 'pkg/b.py'],
    ['namespace.py', 'ns/a.py'], ['namespace.py', 'ns/b.py'],
    ['pkg/local.py', 'pkg/a.py'], ['pkg/local.py', 'pkg/b.py']];
  const map = cli('audit-map', ['--no-compact', '--max-files', '100']);
  const actual = new Set(map.edges.map(edge => `${edge.from.replaceAll('\\', '/')}|${edge.to.replaceAll('\\', '/')}`));
  const missing = expected.filter(([from, to]) => !actual.has(`${from}|${to}`));
  const impacts = ['pkg/b.py', 'ns/b.py'].map(file => {
    const data = cli('impact', ['--file', file]);
    return { file, expectedImporters: expected.filter(edge => edge[1] === file).map(edge => edge[0]),
      actualImporters: data.impact.map(item => path.relative(scratch, item.file).replaceAll('\\', '/')),
      warnings: data.warnings || [] };
  });
  const report = { runtimeImported: imported, expectedNamedSubmoduleEdges: expected, missing, impacts,
    mapWarnings: map.warnings || [], scope: 'Three Python multiple-submodule import forms; no package initialization accuracy claim.' };
  const out = path.join(__dirname, 'truth', 'python-import-truth.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally {
  fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 });
}
