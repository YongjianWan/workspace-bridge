// @semantic
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');
const { FileIndex } = require('../src/services/file-index');
const { WorkspaceCache } = require('../src/services/cache');
const { ProjectContext } = require('../src/utils/project-context');

async function main() {
  const tempRoot = makeTempDir('wb-bug-18-');

  try {
    // 1. Write config using directoryRoles dictionary schema
    fs.mkdirSync(path.join(tempRoot, 'src'), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, 'archive-dir'), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, 'generated-dir'), { recursive: true });

    fs.writeFileSync(
      path.join(tempRoot, '.workspace-bridge.json'),
      JSON.stringify({
        directoryRoles: {
          'archive-dir': 'archive',
          'generated-dir': 'generated',
        },
      }, null, 2)
    );

    fs.writeFileSync(path.join(tempRoot, 'src/main.js'), 'export const active = 1;');
    fs.writeFileSync(path.join(tempRoot, 'archive-dir/old.js'), 'export const old = 1;');
    fs.writeFileSync(path.join(tempRoot, 'generated-dir/bundle.js'), 'export const bundle = 1;');

    const cache = new WorkspaceCache(tempRoot);
    cache.load();

    const pc = new ProjectContext(tempRoot);
    const fileIndex = new FileIndex(tempRoot, cache, {
      projectContext: pc,
      quiet: true,
    });

    // Check directory roles via ProjectContext
    assert.strictEqual(pc.classifyDirectory('archive-dir').role, 'archive');
    assert.strictEqual(pc.classifyDirectory('generated-dir').role, 'generated');
    assert.strictEqual(pc.classifyDirectory('src').role, 'active');

    // Build index
    await fileIndex.build(5000, { watch: false });

    // Assert that files inside archive and generated roles are strictly skipped
    const indexed = fileIndex._indexedFiles.map(f => path.relative(tempRoot, f).replace(/\\/g, '/'));
    assert(indexed.includes('src/main.js'), 'src/main.js should be indexed');
    assert(!indexed.includes('archive-dir/old.js'), 'archive-dir/old.js should be excluded');
    assert(!indexed.includes('generated-dir/bundle.js'), 'generated-dir/bundle.js should be excluded');

    // Clean up caches
    cache.close();

    // 2. Test compatibility with standard directories arrays
    const tempRoot2 = makeTempDir('wb-bug-18-directories-');
    fs.mkdirSync(path.join(tempRoot2, 'src'), { recursive: true });
    fs.mkdirSync(path.join(tempRoot2, 'arch'), { recursive: true });

    fs.writeFileSync(
      path.join(tempRoot2, '.workspace-bridge.json'),
      JSON.stringify({
        directories: {
          archive: ['arch'],
        },
      }, null, 2)
    );

    fs.writeFileSync(path.join(tempRoot2, 'src/main.js'), 'export const active = 1;');
    fs.writeFileSync(path.join(tempRoot2, 'arch/old.js'), 'export const old = 1;');

    const cache2 = new WorkspaceCache(tempRoot2);
    cache2.load();

    const pc2 = new ProjectContext(tempRoot2);
    const fileIndex2 = new FileIndex(tempRoot2, cache2, {
      projectContext: pc2,
      quiet: true,
    });

    assert.strictEqual(pc2.classifyDirectory('arch').role, 'archive');
    await fileIndex2.build(5000, { watch: false });

    const indexed2 = fileIndex2._indexedFiles.map(f => path.relative(tempRoot2, f).replace(/\\/g, '/'));
    assert(indexed2.includes('src/main.js'), 'src/main.js should be indexed');
    assert(!indexed2.includes('arch/old.js'), 'arch/old.js should be excluded');

    cache2.close();
    cleanupTempDir(tempRoot2);

    console.log('test/bug-18-archive-role-test.js ... PASS');
  } finally {
    cleanupTempDir(tempRoot);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
