// @semantic — 新增文件满足 import.meta.glob 时，未改动的 importer 在增量更新后补上依赖边
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');
const { WorkspaceCache } = require('../src/services/cache');
const { FileIndex } = require('../src/services/file-index');
const { DependencyGraph } = require('../src/services/dep-graph');

async function main() {
  const root = makeTempDir('wb-glob-incremental-');
  try {
    fs.mkdirSync(path.join(root, 'mods'));
    fs.writeFileSync(path.join(root, 'mods', 'a.js'), 'export const a = 1;');
    fs.writeFileSync(path.join(root, 'main.js'), "const m = import.meta.glob('./mods/*.js');\nexport default m;");
    fs.writeFileSync(path.join(root, 'package.json'), '{"name":"x"}');
    const cache = new WorkspaceCache(root);
    cache.load();
    cache.setWorkspaceInfo({ root });
    await new FileIndex(root, cache).build(60000, { watch: false });
    const graph = new DependencyGraph(root, cache);
    await graph.build();
    const deps = () => graph.getDependencies(path.join(root, 'main.js')).map(file => path.basename(file)).sort();
    assert.deepStrictEqual(deps(), ['a.js']);

    const added = path.join(root, 'mods', 'b.js');
    fs.writeFileSync(added, 'export const b = 2;');
    await graph.updateFiles([added]);
    assert.deepStrictEqual(deps(), ['a.js', 'b.js'], 'new glob match must reach the unchanged importer');
    console.log('test/p1-glob-incremental-test.js ... PASS');
  } finally { cleanupTempDir(root); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
