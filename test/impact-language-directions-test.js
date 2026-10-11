// @slow
// @semantic
// Real parsers/resolvers feed the same direction contract in all supported main languages.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ServiceContainer } = require('../src/services/container');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

const fixtures = [
  {
    language: 'JS/TS', input: 'a.ts', dependency: 'c.ts', importer: 'consumer.ts', sibling: 'b.ts',
    files: {
      'a.ts': "import { C } from './c'; export class A extends C {}",
      'b.ts': 'export class B {}', 'c.ts': 'export class C {}',
      'consumer.ts': "import { A } from './a'; import { B } from './b'; export const pair = [A, B];",
    },
  },
  {
    language: 'Python', input: 'a.py', dependency: 'c.py', importer: 'consumer.py', sibling: 'b.py',
    files: {
      'a.py': 'from c import C\nclass A(C):\n    pass\n',
      'b.py': 'class B:\n    pass\n', 'c.py': 'class C:\n    pass\n',
      'consumer.py': 'from a import A\nfrom b import B\npair = (A, B)\n',
      'conftest.py': 'import pytest\nfrom a import A\n@pytest.fixture\ndef value():\n    return A()\n',
      'test_value.py': 'def test_value(value):\n    assert value is not None\n',
    },
  },
  {
    language: 'Java', input: 'a/A.java', dependency: 'c/C.java', importer: 'consumer/Consumer.java', sibling: 'b/B.java',
    files: {
      'a/A.java': 'package a; import c.C; public class A { C value; }',
      'b/B.java': 'package b; public class B {}', 'c/C.java': 'package c; public class C {}',
      'consumer/Consumer.java': 'package consumer; import a.A; import b.B; public class Consumer { A a; B b; }',
    },
  },
  {
    language: 'Go', input: 'a/a.go', dependency: 'c/c.go', importer: 'consumer/consumer.go', sibling: 'b/b.go',
    files: {
      'go.mod': 'module example.com/directions\n\ngo 1.22\n',
      'a/a.go': 'package a\nimport "example.com/directions/c"\ntype A struct { Value c.C }\n',
      'b/b.go': 'package b\ntype B struct {}\n', 'c/c.go': 'package c\ntype C struct {}\n',
      'consumer/consumer.go': 'package consumer\nimport "example.com/directions/a"\nimport "example.com/directions/b"\ntype Pair struct { First a.A; Second b.B }\n',
    },
  },
  {
    language: 'Rust', input: 'src/a.rs', dependency: 'src/c.rs', importer: 'src/consumer.rs', sibling: 'src/b.rs',
    files: {
      'Cargo.toml': '[package]\nname = "directions"\nversion = "0.1.0"\nedition = "2021"\n',
      'src/lib.rs': 'pub mod a; pub mod b; pub mod c; pub mod consumer;',
      'src/a.rs': 'use crate::c::C; pub struct A(pub C);',
      'src/b.rs': 'pub struct B;', 'src/c.rs': 'pub struct C;',
      'src/consumer.rs': 'use crate::a::A; use crate::b::B; pub struct Pair(pub A, pub B);',
    },
  },
  {
    language: 'Vue', input: 'A.vue', dependency: 'C.vue', importer: 'Consumer.vue', sibling: 'B.vue',
    files: {
      'A.vue': '<script>import C from "./C.vue"; export default { components: { C } };</script><template><C /></template>',
      'B.vue': '<script>export default {};</script><template><div /></template>',
      'C.vue': '<script>export default {};</script><template><div /></template>',
      'Consumer.vue': '<script>import A from "./A.vue"; import B from "./B.vue"; export default { components: { A, B } };</script><template><A /><B /></template>',
    },
  },
];

async function verifyFixture(fixture) {
  const root = makeTempDir('wb-impact-language-');
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
    const input = file(fixture.input), dependency = file(fixture.dependency);
    const importer = file(fixture.importer), sibling = file(fixture.sibling);
    for (const direction of ['dependents', 'dependencies', 'neighbors', 'all']) {
      const rows = graph.getImpactRadius(input, 5, { direction, stopAtEntry: false });
      const found = new Set(rows.map((r) => graph.normalizeFilePath(r.file)));
      assert(!found.has(input), `${fixture.language}/${direction}: exclude self`);
      if (direction === 'dependencies') {
        assert(found.has(dependency), `${fixture.language}: forward import must resolve`);
        assert(!found.has(importer) && !found.has(sibling), `${fixture.language}: forward direction excludes dependents/siblings`);
      }
      if (direction === 'dependents') {
        assert(found.has(importer), `${fixture.language}: importer must resolve`);
        assert(!found.has(dependency) && !found.has(sibling), `${fixture.language}: reverse direction excludes dependencies/siblings`);
      }
      if (direction === 'neighbors') {
        assert(found.has(sibling), `${fixture.language}: same-importer neighbor must resolve`);
        assert(rows.every((r) => r.reason === 'same-importer'), `${fixture.language}: neighbors must contain only sibling rows`);
      }
      if (direction === 'all') {
        assert([dependency, importer, sibling].every((f) => found.has(f)), `${fixture.language}: all includes each relation`);
      }
    }
    if (fixture.language === 'Python') {
      for (const direction of ['dependents', 'dependencies', 'neighbors', 'all']) {
        const rows = graph.getImpactRadius(file('conftest.py'), 5, { direction });
        const implicit = rows.some((r) => r.reason === 'implicit-conftest');
        assert.strictEqual(implicit, direction === 'dependents' || direction === 'all', `Python/${direction}: implicit rows must follow the requested direction`);
      }
    }
    console.log(`PASS ${fixture.language}: four directions`);
  } finally {
    try { await container.shutdown(); } finally { cleanupTempDir(root); }
  }
}

(async () => {
  for (const fixture of fixtures) await verifyFixture(fixture);
})().catch((err) => { console.error(err); process.exitCode = 1; });
