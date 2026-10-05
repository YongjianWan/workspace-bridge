#!/usr/bin/env node
// @semantic — a test annotated @SpringBootTest boots the whole application, so any JVM source in
// its module can break it even though no import connects them. affected-tests reports it for
// those sources, in that module only, and never for the test's own kind of file.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { WorkspaceCache } = require('../src/services/cache');
const { DependencyGraph } = require('../src/services/dep-graph');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

async function main() {
  const root = makeTempDir('wb-context-tests-');
  const cache = new WorkspaceCache(root, { cacheDir: path.join(root, '.cache') });
  try {
    const write = (name, text) => {
      const full = path.join(root, name);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, text);
      return full;
    };
    const service = write('app/src/main/java/demo/Service.java', 'package demo;\npublic class Service { public int run() { return 1; } }\n');
    const config = write('app/src/main/kotlin/demo/Config.kt', 'package demo\nclass Config { fun name() = "demo" }\n');
    const script = write('app/src/main/resources/static/app.js', 'export const answer = 42;\n');
    const bootTest = write('app/src/test/java/demo/AppIT.java', 'package demo;\n@SpringBootTest\nclass AppIT { void starts() {} }\n');
    const kotlinBootTest = write('app/src/test/kotlin/demo/BootKtTests.kt', 'package demo\n@SpringBootTest\nclass BootKtTests { fun starts() {} }\n');
    const unitTest = write('app/src/test/java/demo/UnitTests.java', 'package demo;\nclass UnitTests { void plain() {} }\n');
    const otherModuleTest = write('other/src/test/java/demo/OtherBootTests.java', 'package demo;\n@SpringBootTest\nclass OtherBootTests { void starts() {} }\n');
    const otherModuleMain = write('other/src/main/java/demo/Other.java', 'package demo;\npublic class Other { }\n');
    const files = [service, config, script, bootTest, kotlinBootTest, unitTest, otherModuleTest, otherModuleMain];
    fs.writeFileSync(path.join(root, 'package.json'), '{"name":"t","version":"1.0.0"}');

    const graph = new DependencyGraph(root, cache, { quiet: true });
    await graph.build(files);
    const base = (rows, source) => rows.filter((r) => r.source === source).map((r) => path.basename(r.file)).sort();

    const forService = graph.findAffectedTests(service, 3);
    assert.deepStrictEqual(base(forService, 'framework'), ['AppIT.java', 'BootKtTests.kt'], 'whole-app tests of the same module, Java and Kotlin alike');
    const row = forService.find((r) => r.source === 'framework');
    assert.deepStrictEqual(row.via, ['@SpringBootTest']);
    assert.strictEqual(row.distance, 4, 'ranked after every graph-derived row');
    assert.ok(!forService.some((r) => path.basename(r.file) === 'OtherBootTests.java'), 'another module is not affected');
    assert.ok(!forService.some((r) => path.basename(r.file) === 'UnitTests.java' && r.source === 'framework'), 'a plain test is not a whole-app test');

    assert.deepStrictEqual(base(graph.findAffectedTests(config, 3), 'framework'), ['AppIT.java', 'BootKtTests.kt'], 'Kotlin sources too');
    assert.deepStrictEqual(base(graph.findAffectedTests(script, 3), 'framework'), [], 'only JVM sources are covered');
    assert.deepStrictEqual(base(graph.findAffectedTests(otherModuleMain, 3), 'framework'), ['OtherBootTests.java']);
    assert.deepStrictEqual(base(graph.findAffectedTests(bootTest, 3), 'framework'), [], 'a test file is never affected through the whole-app rule');

    fs.writeFileSync(bootTest, 'package demo;\nclass AppIT { void starts() {} }\n');
    await graph.updateFiles([bootTest]);
    assert.deepStrictEqual(base(graph.findAffectedTests(service, 3), 'framework'), ['BootKtTests.kt'], 'dropping the annotation drops the row');
    console.log('context-tests-affected-test: OK');
  } finally {
    cache.close();
    cleanupTempDir(root);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
