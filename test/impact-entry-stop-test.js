// @slow
// @semantic
// Entry stop in impact traversal: a file the framework invokes but other files
// still import (MyBatis mapper, JS barrel, Django forms, Go/Rust handlers, App.vue)
// is a pass-through node, not a convergence point. Only a top-level entry that
// no production file imports stops the fan-out — a test importing it does not
// make it part of a chain (Go/Rust tests cannot import main, so they have no such case). Dead-code exemption keeps treating both as entries.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ServiceContainer } = require('../src/services/container');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

// input ← mid（被 import 的入口）← consumer ← root（只被测试 import 的入口）→ extra
const fixtures = [
  {
    language: 'JS/TS', input: 'c.ts', mid: 'lib/index.ts', consumer: 'consumer.ts', root: 'main.ts', extra: 'extra.ts',
    files: {
      'c.ts': 'export class C {}',
      'lib/index.ts': "export { C } from '../c';",
      'consumer.ts': "import { C } from './lib'; export const value = new C();",
      'main.ts': "import { value } from './consumer'; import { extra } from './extra'; console.log(value, extra);",
      'extra.ts': 'export const extra = 1;',
      'main.test.ts': "import './main';",
    },
    testImporter: 'main.test.ts',
  },
  {
    language: 'Python', input: 'c.py', mid: 'forms.py', consumer: 'consumer.py', root: 'manage.py', extra: 'extra.py',
    files: {
      'c.py': 'class C:\n    pass\n',
      'forms.py': 'from c import C\nclass Form(C):\n    pass\n',
      'consumer.py': 'from forms import Form\nvalue = Form()\n',
      'manage.py': 'from consumer import value\nfrom extra import EXTRA\nprint(value, EXTRA)\n',
      'extra.py': 'EXTRA = 1\n',
      'test_manage.py': 'import manage\n',
    },
    testImporter: 'test_manage.py',
  },
  {
    language: 'Java', input: 'domain/User.java', mid: 'mapper/UserMapper.java', consumer: 'service/UserService.java',
    root: 'controller/UserController.java', extra: 'util/Extra.java',
    files: {
      'domain/User.java': 'package domain; public class User {}',
      'mapper/UserMapper.java': 'package mapper; import domain.User; public interface UserMapper { User find(); }',
      'service/UserService.java': 'package service; import mapper.UserMapper; public class UserService { UserMapper mapper; }',
      'controller/UserController.java': 'package controller; import service.UserService; import util.Extra; public class UserController { UserService s; Extra e; }',
      'util/Extra.java': 'package util; public class Extra {}',
      'src/test/java/ctest/UserControllerTest.java': 'package ctest; import controller.UserController; public class UserControllerTest { UserController c; }',
    },
    testImporter: 'src/test/java/ctest/UserControllerTest.java',
  },
  {
    language: 'Go', input: 'c/c.go', mid: 'handlers/h.go', consumer: 'consumer/consumer.go', root: 'main.go', extra: 'extra/extra.go',
    files: {
      'go.mod': 'module example.com/entrystop\n\ngo 1.22\n',
      'c/c.go': 'package c\ntype C struct {}\n',
      'handlers/h.go': 'package handlers\nimport "example.com/entrystop/c"\ntype H struct { Value c.C }\n',
      'consumer/consumer.go': 'package consumer\nimport "example.com/entrystop/handlers"\ntype Use struct { H handlers.H }\n',
      'main.go': 'package main\nimport "example.com/entrystop/consumer"\nimport "example.com/entrystop/extra"\nfunc main() { _ = consumer.Use{}; _ = extra.E{} }\n',
      'extra/extra.go': 'package extra\ntype E struct {}\n',
    },
  },
  {
    language: 'Rust', input: 'src/c.rs', mid: 'src/handlers/mod.rs', consumer: 'src/consumer.rs', root: 'src/main.rs', extra: 'src/extra.rs',
    files: {
      'Cargo.toml': '[package]\nname = "entrystop"\nversion = "0.1.0"\nedition = "2021"\n',
      'src/c.rs': 'pub struct C;',
      'src/handlers/mod.rs': 'use crate::c::C; pub struct H(pub C);',
      'src/consumer.rs': 'use crate::handlers::H; pub struct Use(pub H);',
      'src/main.rs': 'mod c; mod handlers; mod consumer; mod extra; fn main() { let _ = extra::E; }',
      'src/extra.rs': 'pub struct E;',
    },
  },
  {
    language: 'Vue', input: 'C.vue', mid: 'App.vue', consumer: 'main.ts', root: 'main.ts', extra: 'extra.ts',
    files: {
      'C.vue': '<script>export default {};</script><template><div /></template>',
      'App.vue': '<script>import C from "./C.vue"; export default { components: { C } };</script><template><C /></template>',
      'main.ts': "import App from './App.vue'; import { extra } from './extra'; console.log(App, extra);",
      'extra.ts': 'export const extra = 1;',
      'main.test.ts': "import './main';",
    },
    testImporter: 'main.test.ts',
  },
];

async function verifyFixture(fixture) {
  const root = makeTempDir('wb-impact-entry-stop-');
  const container = new ServiceContainer({ quiet: true, cacheDir: path.join(root, '.cache') });
  try {
    for (const [file, content] of Object.entries(fixture.files)) {
      const target = path.join(root, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
    await container.initialize(root, 30000, { watch: false, quiet: true });
    const graph = container.snapshot.graph;
    const file = (relative) => graph.normalizeFilePath(path.join(root, relative));
    const [input, mid, consumer, top, extra] = [fixture.input, fixture.mid, fixture.consumer, fixture.root, fixture.extra].map(file);
    const found = (direction, stopAtEntry) => new Set(graph.getImpactRadius(input, 5, { direction, stopAtEntry })
      .map((r) => graph.normalizeFilePath(r.file)));

    // The fixture only means something if both files really are classified as entries.
    assert(graph.isKnownEntryFile(mid), `${fixture.language}: ${fixture.mid} must be an entry`);
    assert(graph.isKnownEntryFile(top), `${fixture.language}: ${fixture.root} must be an entry`);
    assert(graph.getDependents(mid).length > 0, `${fixture.language}: ${fixture.mid} must be imported`);
    const topImporters = graph.getDependents(top);
    assert(topImporters.every((f) => graph.isTestLikeFile(f)), `${fixture.language}: only tests may import ${fixture.root}`);
    if (fixture.testImporter) {
      assert.deepStrictEqual(topImporters, [file(fixture.testImporter)], `${fixture.language}: ${fixture.testImporter} must import ${fixture.root}`);
    }

    // An imported entry is a pass-through node, in either direction.
    for (const direction of ['dependents', 'all']) {
      const rows = found(direction, true);
      assert(rows.has(mid) && rows.has(consumer), `${fixture.language}/${direction}: traversal passes through ${fixture.mid}`);
      assert(rows.has(top), `${fixture.language}/${direction}: the top-level entry is still reported`);
    }
    // A top-level entry stops the fan-out, unless the caller turns stopping off.
    assert(!found('all', true).has(extra), `${fixture.language}: ${fixture.root} must not fan out to ${fixture.extra}`);
    assert(found('all', false).has(extra), `${fixture.language}: stopAtEntry=false still fans out`);
    console.log(`PASS ${fixture.language}: imported entries pass through, top-level entries stop`);
  } finally {
    try { await container.shutdown(); } finally { cleanupTempDir(root); }
  }
}

(async () => {
  for (const fixture of fixtures) await verifyFixture(fixture);
})().catch((err) => { console.error(err); process.exitCode = 1; });
