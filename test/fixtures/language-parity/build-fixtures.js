/**
 * Language-parity fixtures — ten minimal "A depends on B" projects, one per
 * supported language (JS/TS counted separately).
 *
 * Each fixture carries the marker files its language's registry `condition`
 * keys on (detectWorkspace in src/utils/path.js): package.json, tsconfig.json,
 * requirements.txt, pom.xml, build.gradle.kts, go.mod, Cargo.toml,
 * CMakeLists.txt. Without the marker the file indexer skips the language's
 * glob patterns and the fixture would measure nothing.
 *
 * `expectedMethods` are the resolution_method values that prove the import was
 * resolved *structurally* (relative path, package mapping, module path). A
 * 'symbol-table' edge is name-guessing and does not count as parity — see
 * TECH_DEBT L2-10 for why.
 *
 * `needsPython` marks fixtures whose AST parser spawns a Python script
 * (spawn-ast.js); on machines without the toolchain they degrade to the regex
 * fallback, and the test reports an environment skip instead of a language
 * defect.
 */

const fs = require('fs');
const path = require('path');

const FIXTURES = [
  {
    language: 'javascript',
    needsPython: false,
    expectedMethods: ['relative'],
    files: {
      'package.json': JSON.stringify({ name: 'parity-js', version: '1.0.0' }),
      'src/b.js': 'function helper() { return 1; }\nmodule.exports = { helper };\n',
      'src/a.js':
        "const { helper } = require('./b');\nmodule.exports = { run: () => helper() };\n",
    },
  },
  {
    language: 'typescript',
    needsPython: false,
    expectedMethods: ['relative'],
    files: {
      'package.json': JSON.stringify({ name: 'parity-ts', version: '1.0.0' }),
      'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true } }),
      'src/b.ts': 'export function helper(): number {\n  return 1;\n}\n',
      'src/a.ts': "import { helper } from './b';\n\nexport const run = (): number => helper();\n",
    },
  },
  {
    language: 'python',
    needsPython: true, // python_ast_parser.py; regex fallback still extracts imports
    expectedMethods: ['python-absolute', 'python-relative'],
    files: {
      'requirements.txt': '# parity fixture — intentionally empty\n',
      'b.py': 'def helper():\n    return 1\n',
      'a.py': 'from b import helper\n\n\ndef run():\n    return helper()\n',
    },
  },
  {
    language: 'java',
    needsPython: true, // java_ast_parser.py needs python + javalang
    expectedMethods: ['java-package'],
    files: {
      'pom.xml':
        '<project>\n' +
        '  <modelVersion>4.0.0</modelVersion>\n' +
        '  <groupId>com.example</groupId>\n' +
        '  <artifactId>parity</artifactId>\n' +
        '  <version>1.0</version>\n' +
        '</project>\n',
      'src/main/java/com/example/util/B.java':
        'package com.example.util;\n\npublic class B {\n    public static int helper() {\n        return 1;\n    }\n}\n',
      'src/main/java/com/example/A.java':
        'package com.example;\n\nimport com.example.util.B;\n\npublic class A {\n    public int run() {\n        return B.helper();\n    }\n}\n',
    },
  },
  {
    language: 'kotlin',
    needsPython: false,
    expectedMethods: ['java-package'],
    files: {
      'build.gradle.kts': '// parity fixture marker\nplugins {\n    kotlin("jvm") version "1.9.0"\n}\n',
      'src/main/kotlin/com/example/util/B.kt':
        'package com.example.util\n\nobject B {\n    fun helper(): Int = 1\n}\n',
      'src/main/kotlin/com/example/A.kt':
        'package com.example\n\nimport com.example.util.B\n\nclass A {\n    fun run(): Int = B.helper()\n}\n',
    },
  },
  {
    language: 'go',
    needsPython: false,
    expectedMethods: ['go-module', 'go-relative'],
    files: {
      'go.mod': 'module example.com/parity\n\ngo 1.21\n',
      'pkg/b/b.go': 'package b\n\nfunc Helper() int {\n\treturn 1\n}\n',
      'main.go':
        'package main\n\nimport (\n\t"fmt"\n\n\t"example.com/parity/pkg/b"\n)\n\nfunc main() {\n\tfmt.Println(b.Helper())\n}\n',
    },
  },
  {
    language: 'rust',
    needsPython: false,
    expectedMethods: ['rust-crate', 'rust-super'],
    files: {
      'Cargo.toml': '[package]\nname = "parity-fixture"\nversion = "0.1.0"\nedition = "2021"\n',
      'src/main.rs': 'mod b;\n\nuse crate::b::helper;\n\nfn main() {\n    helper();\n}\n',
      'src/b.rs': 'pub fn helper() -> i32 {\n    1\n}\n',
    },
  },
  {
    language: 'cpp',
    needsPython: false,
    // '#include "b.h"' is quote-form — C/C++ relative semantics without the './'.
    // Method name lands with T2 (tryCppInclude); there is no structural resolver
    // for C/C++ before that (L1-4).
    expectedMethods: ['cpp-include'],
    files: {
      'CMakeLists.txt':
        'cmake_minimum_required(VERSION 3.16)\nproject(parity C)\nadd_executable(parity src/a.c src/b.c)\n',
      'src/b.h': '#ifndef PARITY_B_H\n#define PARITY_B_H\n\nint helper(void);\n\n#endif\n',
      'src/b.c': '#include "b.h"\n\nint helper(void) {\n    return 1;\n}\n',
      'src/a.c': '#include "b.h"\n\nint main(void) {\n    return helper();\n}\n',
    },
  },
  {
    language: 'vue',
    needsPython: false,
    expectedMethods: ['relative'],
    files: {
      'package.json': JSON.stringify({ name: 'parity-vue', version: '1.0.0' }),
      'src/b.js': 'export function helper() { return 1; }\n',
      'src/A.vue':
        '<template>\n  <div>{{ value }}</div>\n</template>\n\n' +
        '<script>\n' +
        "import { helper } from './b';\n\n" +
        'export default {\n' +
        '  computed: {\n' +
        '    value() {\n' +
        '      return helper();\n' +
        '    },\n' +
        '  },\n' +
        '};\n' +
        '</script>\n',
    },
  },
  {
    language: 'svelte',
    needsPython: false,
    expectedMethods: ['relative'],
    files: {
      'package.json': JSON.stringify({ name: 'parity-svelte', version: '1.0.0' }),
      'src/b.js': 'export function helper() { return 1; }\n',
      'src/A.svelte':
        '<script>\n' +
        "  import { helper } from './b';\n" +
        '  const value = helper();\n' +
        '</script>\n\n<p>{value}</p>\n',
    },
  },
];

/**
 * Write every fixture under `rootDir` (one subdirectory per language).
 * @param {string} rootDir — must exist or be creatable
 * @returns {Array<object>} fixture descriptors with an added `dir` field
 */
function buildFixtures(rootDir) {
  fs.mkdirSync(rootDir, { recursive: true });
  return FIXTURES.map((fixture) => {
    const dir = path.join(rootDir, fixture.language);
    for (const [rel, content] of Object.entries(fixture.files)) {
      const target = path.join(dir, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
    return { ...fixture, dir };
  });
}

module.exports = { FIXTURES, buildFixtures };
