#!/usr/bin/env node
// @semantic
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { normalizePathKey } = require('../src/utils/path');
const { makeTempDir, cleanupTempDir, createMockDepGraph } = require('./test-helpers');

function n(p) {
  return normalizePathKey(p);
}

function testJavaAstConservativeWithUsageScan() {
  const tmpDir = makeTempDir('wb-java-de-');
  const fooPath = path.join(tmpDir, 'Foo.java');
  const consumerPath = path.join(tmpDir, 'Consumer.java');

  // Foo has bar (used) and baz (unused)
  fs.writeFileSync(fooPath, `
public class Foo {
    public void bar() {}
    public void baz() {}
}
`);
  // Consumer calls bar via instance — import record only captures 'Foo', not 'bar'
  fs.writeFileSync(consumerPath, `
import example.Foo;
public class Consumer {
    public void run() {
        Foo f = new Foo();
        f.bar();
    }
}
`);

  const fooKey = n(fooPath);
  const consumerKey = n(consumerPath);

  const depGraph = createMockDepGraph({
    root: tmpDir,
    schema: {
      [fooKey]: {
        imports: [],
        exports: ['Foo', 'bar', 'baz'],
        importRecords: [],
        exportRecords: [{ name: 'Foo' }, { name: 'bar' }, { name: 'baz' }],
        parseMode: 'ast',
        confidence: 'high',
      },
      [consumerKey]: {
        imports: [fooKey],
        exports: ['Consumer'],
        importRecords: [{
          source: 'com.example.Foo',
          imported: ['Foo'],
          usesAllExports: false,
          resolved: fooKey,
        }],
        exportRecords: [{ name: 'Consumer' }],
        parseMode: 'ast',
        confidence: 'high',
      }
    }
  });

  const dead = depGraph.findDeadExports();
  const fooDead = dead.find((d) => d.file === fooKey);

  // bar is used via instance call (f.bar()) — P1 usage scan should catch it
  assert(!fooDead || !fooDead.exports.includes('bar'), 'bar should not be dead-export (used via instance call)');
  // baz is truly unused
  assert(!fooDead || fooDead.exports.includes('baz'), 'baz should still be dead-export');

  cleanupTempDir(tmpDir);
}

function testJavaRegexNoImporter() {
  const regexPath = n('/repo/src/main/java/com/example/RegexOnly.java');
  const depGraph = createMockDepGraph({
    schema: {
      [regexPath]: {
        imports: [],
        exports: ['RegexOnly'],
        importRecords: [],
        exportRecords: [{ name: 'RegexOnly' }],
        parseMode: 'regex',
        confidence: 'medium',
      }
    }
  });

  const dead = depGraph.findDeadExports();
  const regexDead = dead.find((d) => d.file === regexPath);
  assert(regexDead, 'Java regex file with no importers should be reported as dead');
  assert.strictEqual(regexDead.confidence, 'high');
}

function main() {
  testJavaAstConservativeWithUsageScan();
  testJavaRegexNoImporter();
}

main();
