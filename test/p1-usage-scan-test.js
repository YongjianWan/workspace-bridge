const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const { DependencyGraph } = require('../src/services/dep-graph');

function testScanSymbolUsage() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-p1-'));
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

  const graph = new DependencyGraph(tmpDir);

  const used = graph._scanSymbolUsageInImporters([mainPath], ['bar', 'baz', 'someField'], path.join(tmpDir, 'Foo.java'));

  assert(used.has('bar'), 'bar should be detected as used (method call)');
  assert(used.has('someField'), 'someField should be detected as used (field access)');
  assert(!used.has('baz'), 'baz should not be detected as used');

  fs.rmSync(tmpDir, { recursive: true });
  console.log('testScanSymbolUsage passed');
}

function testGoUsageScan() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-p1-go-'));
  const mainPath = path.join(tmpDir, 'main.go');

  fs.writeFileSync(mainPath, `
package main
import "example.com/foo"
func main() {
    foo.Bar()
}
`);

  const graph = new DependencyGraph(tmpDir);
  const used = graph._scanSymbolUsageInImporters([mainPath], ['Bar', 'Baz'], path.join(tmpDir, 'foo.go'));

  assert(used.has('Bar'), 'Bar should be detected as used (pkg.Func call)');
  assert(!used.has('Baz'), 'Baz should not be detected as used');

  fs.rmSync(tmpDir, { recursive: true });
  console.log('testGoUsageScan passed');
}

function testFindDeadExportsWithUsageScan() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-p1-de-'));
  const fooPath = path.join(tmpDir, 'Foo.java');
  const mainPath = path.join(tmpDir, 'Main.java');

  fs.writeFileSync(fooPath, `public class Foo { public void bar() {} public void baz() {} }`);
  fs.writeFileSync(mainPath, `import example.Foo; public class Main { public void run() { Foo f = new Foo(); f.bar(); } }`);

  const graph = new DependencyGraph(tmpDir);

  // Manually inject parsed info to bypass AST parser dependency
  const fooKey = graph.normalizeFilePath(fooPath);
  const mainKey = graph.normalizeFilePath(mainPath);

  graph.graph.set(fooKey, {
    imports: [],
    exports: ['Foo', 'bar', 'baz'],
    importRecords: [],
    exportRecords: [],
    parseMode: 'ast',
  });

  graph.graph.set(mainKey, {
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
  });

  graph.buildReverseGraph();

  const deadExports = graph.findDeadExports();
  const fooDead = deadExports.find((d) => d.file === fooKey);

  assert(!fooDead || !fooDead.exports.includes('bar'), 'bar should not be dead-export (used via instance call)');
  assert(!fooDead || fooDead.exports.includes('baz'), 'baz should still be dead-export');

  fs.rmSync(tmpDir, { recursive: true });
  console.log('testFindDeadExportsWithUsageScan passed');
}

function testSymbolEscaping() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-p1-esc-'));
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

  const graph = new DependencyGraph(tmpDir);
  const used = graph._scanSymbolUsageInImporters([mainPath], ['$bar', '$baz', '$someField'], path.join(tmpDir, 'Foo.java'));

  assert(used.has('$bar'), '$bar should be detected as used despite $ in symbol');
  assert(used.has('$someField'), '$someField should be detected as used despite $ in symbol');
  assert(!used.has('$baz'), '$baz should not be detected as used');

  fs.rmSync(tmpDir, { recursive: true });
  console.log('testSymbolEscaping passed');
}

function main() {
  testScanSymbolUsage();
  testGoUsageScan();
  testFindDeadExportsWithUsageScan();
  testSymbolEscaping();
  console.log('All P1 usage scan tests passed');
}

main();
