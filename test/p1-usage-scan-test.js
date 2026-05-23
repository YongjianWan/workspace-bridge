const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { makeTempDir, cleanupTempDir, createMockDepGraph } = require('./test-helpers');

function testScanSymbolUsage() {
  const tmpDir = makeTempDir('wb-p1-');
  const mainPath = path.join(tmpDir, 'Main.java');

  fs.writeFileSync(mainPath, `
import example.Foo;
public class Main {
    public void run() {
        Foo f = new Foo();
        f.bar();
        int x = f.someField;
    }
}
`);

  const graph = createMockDepGraph({ root: tmpDir });

  const used = graph._scanSymbolUsageInImporters([mainPath], ['bar', 'baz', 'someField'], path.join(tmpDir, 'Foo.java'));

  assert(used.has('bar'), 'bar should be detected as used (method call)');
  assert(used.has('someField'), 'someField should be detected as used (field access)');
  assert(!used.has('baz'), 'baz should not be detected as used');

  cleanupTempDir(tmpDir);
}

function testGoUsageScan() {
  const tmpDir = makeTempDir('wb-p1-go-');
  const mainPath = path.join(tmpDir, 'main.go');

  fs.writeFileSync(mainPath, `
package main
import "example.com/foo"
func main() {
    foo.Bar()
}
`);

  const graph = createMockDepGraph({ root: tmpDir });
  const used = graph._scanSymbolUsageInImporters([mainPath], ['Bar', 'Baz'], path.join(tmpDir, 'foo.go'));

  assert(used.has('Bar'), 'Bar should be detected as used (pkg.Func call)');
  assert(!used.has('Baz'), 'Baz should not be detected as used');

  cleanupTempDir(tmpDir);
}

function testFindDeadExportsWithUsageScan() {
  const tmpDir = makeTempDir('wb-p1-de-');
  const fooPath = path.join(tmpDir, 'Foo.java');
  const mainPath = path.join(tmpDir, 'Main.java');

  fs.writeFileSync(fooPath, `public class Foo { public void bar() {} public void baz() {} }`);
  fs.writeFileSync(mainPath, `import example.Foo; public class Main { public void run() { Foo f = new Foo(); f.bar(); } }`);

  const fooKey = fooPath.replace(/\\/g, '/'); // simple normalization path for schema key
  const mainKey = mainPath.replace(/\\/g, '/');

  const graph = createMockDepGraph({
    root: tmpDir,
    schema: {
      [fooKey]: {
        originalPath: fooPath,
        imports: [],
        exports: ['Foo', 'bar', 'baz'],
        importRecords: [],
        exportRecords: [],
        parseMode: 'ast',
      },
      [mainKey]: {
        originalPath: mainPath,
        imports: [fooKey],
        exports: [],
        importRecords: [{
          source: 'example.Foo',
          resolved: fooKey,
          imported: ['Foo'],
          usesAllExports: false,
        }],
        exportRecords: [],
        parseMode: 'ast',
      }
    }
  });

  const deadExports = graph.findDeadExports();
  const fooDead = deadExports.find((d) => d.file === fooKey);

  assert(!fooDead || !fooDead.exports.includes('bar'), 'bar should not be dead-export (used via instance call)');
  assert(!fooDead || fooDead.exports.includes('baz'), 'baz should still be dead-export');

  cleanupTempDir(tmpDir);
}

function testSymbolEscaping() {
  const tmpDir = makeTempDir('wb-p1-esc-');
  const mainPath = path.join(tmpDir, 'Main.java');

  // Symbol with $ (valid in Java identifiers) should not throw or mis-match
  fs.writeFileSync(mainPath, `
  import example.Foo;
  public class Main {
      public void run() {
          Foo f = new Foo();
          f.$bar();
          int x = f.$someField;
      }
  }
  `);

  const graph = createMockDepGraph({ root: tmpDir });
  const used = graph._scanSymbolUsageInImporters([mainPath], ['$bar', '$baz', '$someField'], path.join(tmpDir, 'Foo.java'));

  assert(used.has('$bar'), '$bar should be detected as used despite $ in symbol');
  assert(used.has('$someField'), '$someField should be detected as used despite $ in symbol');
  assert(!used.has('$baz'), '$baz should not be detected as used');

  cleanupTempDir(tmpDir);
}

function testScanContentCache() {
  const tmpDir = makeTempDir('wb-p1-cache-');
  const mainPath = path.join(tmpDir, 'Main.java');

  fs.writeFileSync(mainPath, `
  import example.Foo;
  public class Main {
      public void run() {
          Foo f = new Foo();
          f.bar();
          f.baz();
      }
  }
  `);

  const graph = createMockDepGraph({ root: tmpDir });

  // First call: should read file and populate cache
  const used1 = graph._scanSymbolUsageInImporters([mainPath], ['bar'], path.join(tmpDir, 'Foo.java'));
  assert(used1.has('bar'), 'bar should be detected');
  assert(graph._scanContentCache.has(mainPath), 'content cache should contain importer after first scan');
  assert(graph._scanPatternCache.has('bar:java'), 'pattern cache should contain bar pattern after first scan');

  // Second call with different symbol: should reuse cache, no extra file read
  let readCount = 0;
  const originalRead = fs.readFileSync;
  fs.readFileSync = (...args) => {
    if (args[0] === mainPath) readCount++;
    return originalRead.apply(fs, args);
  };
  try {
    const used2 = graph._scanSymbolUsageInImporters([mainPath], ['baz'], path.join(tmpDir, 'Foo.java'));
    assert(used2.has('baz'), 'baz should be detected');
    assert.strictEqual(readCount, 0, 'should not re-read cached file content');
  } finally {
    fs.readFileSync = originalRead;
  }

  cleanupTempDir(tmpDir);
}

function testScanContentCacheBoundary() {
  const tmpDir = makeTempDir('wb-p1-boundary-');
  const mainPath = path.join(tmpDir, 'Main.java');

  fs.writeFileSync(mainPath, `
  import example.Foo;
  public class Main {
      public void run() {
          Foo f = new Foo();
          f.bar();
      }
  }
  `);

  const graph = createMockDepGraph({ root: tmpDir });

  // Scan once to populate cache
  const used = graph._scanSymbolUsageInImporters([mainPath], ['bar'], path.join(tmpDir, 'Foo.java'));
  assert(used.has('bar'));
  assert(graph._scanContentCache.has(mainPath), 'cache should have mainPath');

  // Emit graph:updated and verify cache gets fully cleared
  graph.bus.emit('graph:updated');
  assert.strictEqual(graph._scanContentCache.size, 0, 'cache should be cleared after graph:updated');
  assert.strictEqual(graph._scanPatternCache.size, 0, 'pattern cache should be cleared after graph:updated');

  cleanupTempDir(tmpDir);
}

function main() {
  testScanSymbolUsage();
  testGoUsageScan();
  testFindDeadExportsWithUsageScan();
  testSymbolEscaping();
  testScanContentCache();
  testScanContentCacheBoundary();
}

main();
