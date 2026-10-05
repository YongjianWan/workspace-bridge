// @semantic
const assert = require('assert');
const { classifyDeadExports } = require('../src/tools/honesty-engine');
const { buildHotspots } = require('../src/tools/overview-assembler');
const { Ledger } = require('../src/services/ledger');

async function main() {
  const items = ['src/component.js', 'src/App.stories.tsx', '.storybook/preview.tsx'].map(file => ({ file, importerCount: 0, confidence: 'high' }));
  classifyDeadExports(items, { getStats: () => ({ files: 3, totalImports: 10 }) });
  assert(items.every(item => item.safeToDelete !== true), 'zero importers is not proof of safe deletion');
  const files = Array.from({ length: 60 }, (_, i) => `/repo/f${i}.js`);
  const graph = {
    ledger: new Ledger(),
    getFileCount: () => files.length,
    _displayPath: (p) => p,
    getFrameworkHint: () => null,
    isTestLikeFile: () => false,
    getAllFilePaths: () => files,
    getDependencies: file => file === files[59] ? [] : [files[59]],
    getDependents: file => file === files[59] ? files.slice(0, 59) : [],
    graph: new Map(files.map(file => [file, { imports: file === files[59] ? [] : [files[59]] }])),
  };
  const failures = [];
  const hotspots = await buildHotspots('/repo', graph, files, async () => ({ ok: false, error: 'git failed' }), failures);
  assert(hotspots.some(item => item.file === 'f59.js'), 'candidate ranking must include the most depended-on file beyond first 50');
  assert(failures.length > 0, 'failed history reads must be observable');
  console.log('p1 output trust: 3/3 passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
