#!/usr/bin/env node
// @semantic
// @slow
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { runCliInProcessRaw, makeTempDir, cleanupTempDir } = require('./test-helpers');

function parseJson(result) {
  let stdout = result.stdout;
  if (stdout && stdout.startsWith('\ufeff')) stdout = stdout.slice(1);
  return JSON.parse(stdout);
}

async function runDeadExports(cwd) {
  return await runCliInProcessRaw(['dead-exports', '--cwd', cwd, '--json', '--quiet'], { cwd });
}

function writeFile(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
}

function mapDeadExportsByBaseName(deadExports) {
  const result = new Map();
  for (const item of deadExports || []) {
    result.set(path.basename(item.file), item.exports || []);
  }
  return result;
}

async function main() {
  const tempDir = makeTempDir('wb-dead-export-gt-9lang-');
  try {
    // Polyglot manifest files to ensure workspace detector enables all 9 language parsers
    writeFile(tempDir, 'package.json', JSON.stringify({ name: 'dead-export-gt-9lang', version: '1.0.0' }));
    writeFile(tempDir, 'pyproject.toml', '[project]\nname = "gt-py"\nversion = "0.1.0"\n');
    writeFile(tempDir, 'pom.xml', '<project><groupId>com.gt</groupId><artifactId>gt-java</artifactId><version>1.0.0</version></project>');
    writeFile(tempDir, 'go.mod', 'module example.com/gt\n');
    writeFile(tempDir, 'Cargo.toml', '[package]\nname = "gt_rs"\nversion = "0.1.0"\n');
    writeFile(tempDir, 'CMakeLists.txt', 'project(gt_cpp)\n');

    // 1. JS / TS corpus (symbol-level dead export & unimported module)
    writeFile(
      tempDir,
      'src/js/lib.js',
      `export function usedFn() { return 1; }\nexport function deadFn() { return 2; }\n`
    );
    writeFile(
      tempDir,
      'src/js/consumer.js',
      `import { usedFn } from './lib.js';\nconsole.log(usedFn());\n`
    );
    writeFile(
      tempDir,
      'src/js/orphan.js',
      `export const orphanValue = 42;\n`
    );
    writeFile(
      tempDir,
      'src/js/live.test.js',
      `export const helper = 1;\n`
    );

    // 2. Vue SFC corpus (symbol-level dead export)
    writeFile(
      tempDir,
      'src/vue/Component.vue',
      `<script>\nexport function usedVueFn() { return 1; }\nexport function deadVueFn() { return 2; }\n</script>\n`
    );
    writeFile(
      tempDir,
      'src/vue/App.vue',
      `<script>\nimport { usedVueFn } from './Component.vue';\nusedVueFn();\n</script>\n`
    );

    // 3. Svelte corpus (symbol-level dead export)
    writeFile(
      tempDir,
      'src/svelte/Widget.svelte',
      `<script context="module">\nexport function usedSvelteFn() { return 1; }\nexport function deadSvelteFn() { return 2; }\n</script>\n`
    );
    writeFile(
      tempDir,
      'src/svelte/App.svelte',
      `<script>\nimport { usedSvelteFn } from './Widget.svelte';\nusedSvelteFn();\n</script>\n`
    );

    // 4. Python unimported module corpus
    writeFile(
      tempDir,
      'src/py/unused_mod.py',
      `def unused_py_fn():\n    return 42\n`
    );
    writeFile(
      tempDir,
      'src/py/used_mod.py',
      `def used_py_fn():\n    return 1\n`
    );
    writeFile(
      tempDir,
      'src/py/main.py',
      `from .used_mod import used_py_fn\nused_py_fn()\n`
    );

    // 5. Java multi-package corpus (@RestController makes JavaConsumer an entry point)
    writeFile(
      tempDir,
      'src/main/java/com/gt/unused/UnusedJava.java',
      `package com.gt.unused;\npublic class UnusedJava {\n  public static void unusedMethod() {}\n}\n`
    );
    writeFile(
      tempDir,
      'src/main/java/com/gt/lib/UsedJava.java',
      `package com.gt.lib;\npublic class UsedJava {\n  public static void usedMethod() {}\n}\n`
    );
    writeFile(
      tempDir,
      'src/main/java/com/gt/consumer/JavaConsumer.java',
      `package com.gt.consumer;\nimport com.gt.lib.UsedJava;\nimport org.springframework.web.bind.annotation.RestController;\n@RestController\npublic class JavaConsumer {\n  public static void run() { UsedJava.usedMethod(); }\n}\n`
    );

    // 6. Kotlin multi-package corpus (@RestController makes KtConsumer an entry point)
    writeFile(
      tempDir,
      'src/main/kotlin/com/gt/unused/UnusedKt.kt',
      `package com.gt.unused\nclass UnusedKtClass {\n  fun unused() = 1\n}\n`
    );
    writeFile(
      tempDir,
      'src/main/kotlin/com/gt/lib/UsedKt.kt',
      `package com.gt.lib\nclass UsedKtClass\n`
    );
    writeFile(
      tempDir,
      'src/main/kotlin/com/gt/consumer/KtConsumer.kt',
      `package com.gt.consumer\nimport com.gt.lib.UsedKtClass\nimport org.springframework.web.bind.annotation.RestController\n@RestController\nclass KtConsumer {\n  fun run() { val x = UsedKtClass() }\n}\n`
    );

    // 7. Go unimported package corpus
    writeFile(
      tempDir,
      'src/go/unused/unused.go',
      `package unused\nfunc UnusedGoFn() int { return 99 }\n`
    );
    writeFile(
      tempDir,
      'src/go/used/used.go',
      `package used\nfunc UsedGoFn() int { return 1 }\n`
    );
    writeFile(
      tempDir,
      'src/go/main.go',
      `package main\nimport "example.com/gt/src/go/used"\nfunc main() { used.UsedGoFn() }\n`
    );

    // 8. Rust unimported module corpus
    writeFile(
      tempDir,
      'src/rs/unused.rs',
      `pub fn unused_rs_fn() {}\n`
    );
    writeFile(
      tempDir,
      'src/rs/used.rs',
      `pub fn used_rs_fn() {}\n`
    );
    writeFile(
      tempDir,
      'src/rs/main.rs',
      `mod used;\nuse used::used_rs_fn;\nfn main() { used_rs_fn(); }\n`
    );

    // 9. C/C++ unimported header corpus
    writeFile(
      tempDir,
      'src/cpp/unused.h',
      `void unused_cpp_fn() {}\n`
    );
    writeFile(
      tempDir,
      'src/cpp/used.h',
      `void used_cpp_fn() {}\n`
    );
    writeFile(
      tempDir,
      'src/cpp/main.cpp',
      `#include "used.h"\nvoid main() { used_cpp_fn(); }\n`
    );

    const result = await runDeadExports(tempDir);
    assert.strictEqual(result.status, 0, `CLI failed: ${result.stderr}`);
    const data = parseJson(result);
    const byBaseName = mapDeadExportsByBaseName(data.deadExports);

    // Ground-truth dead export files across all 9 languages
    const expectedPositives = {
      'lib.js': ['deadFn'],
      'orphan.js': ['orphanValue'],
      'Component.vue': ['deadVueFn'],
      'Widget.svelte': ['deadSvelteFn'],
      'unused_mod.py': ['unused_py_fn'],
      'UnusedJava.java': ['UnusedJava'],
      'UnusedKt.kt': ['UnusedKtClass'],
      'unused.go': ['UnusedGoFn'],
      'unused.rs': ['unused_rs_fn'],
      'unused.h': ['unused_cpp_fn'],
    };

    const expectedNegatives = [
      'consumer.js',
      'live.test.js',
      'App.vue',
      'App.svelte',
      'used_mod.py',
      'main.py',
      'UsedJava.java',
      'JavaConsumer.java',
      'UsedKt.kt',
      'KtConsumer.kt',
      'used.go',
      'main.go',
      'used.rs',
      'main.rs',
      'used.h',
      'main.cpp',
    ];

    for (const [baseName, expectedExports] of Object.entries(expectedPositives)) {
      assert(byBaseName.has(baseName), `ground-truth corpus should report ${baseName}`);
      const actualExports = byBaseName.get(baseName);
      for (const exp of expectedExports) {
        assert(
          actualExports.includes(exp),
          `${baseName} should report dead export '${exp}', got: ${JSON.stringify(actualExports)}`
        );
      }
    }

    for (const baseName of expectedNegatives) {
      assert(!byBaseName.has(baseName), `ground-truth corpus should not report live file ${baseName}`);
    }

    const truePositives = Object.keys(expectedPositives).length;
    const falsePositives = data.deadExports.filter((item) =>
      !Object.prototype.hasOwnProperty.call(expectedPositives, path.basename(item.file))
    ).length;

    assert.strictEqual(
      falsePositives,
      0,
      `ground-truth corpus should not produce extra findings, got: ${JSON.stringify(data.deadExports.map((item) => item.file))}`
    );
    assert.strictEqual(truePositives, 10, 'expected 10 ground-truth dead export files across all 9 languages');

    const precision = truePositives / (truePositives + falsePositives || 1);
    const recall = truePositives / (Object.keys(expectedPositives).length || 1);
    assert.strictEqual(precision, 1, `precision should be 1 on the 9-language ground-truth corpus, got ${precision}`);
    assert.strictEqual(recall, 1, `recall should be 1 on the 9-language ground-truth corpus, got ${recall}`);
  } finally {
    cleanupTempDir(tempDir);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
