#!/usr/bin/env node
// @fast
// @semantic
/**
 * A Java/Kotlin file with a main function is an executable entry point, whatever its
 * file name: it must not be reported as an orphan module. A class without one still is.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { runCliRaw, makeTempDir, cleanupTempDir } = require('./test-helpers');

const root = makeTempDir('wb-jvm-main-');
try {
  const javaDir = path.join(root, 'src', 'main', 'java', 'x');
  fs.mkdirSync(javaDir, { recursive: true });
  fs.writeFileSync(path.join(javaDir, 'Main.java'), 'package x;\npublic class Main {\n  public static void main(String[] args) {}\n}\n');
  fs.writeFileSync(path.join(javaDir, 'Launcher.java'), 'package x;\npublic class Launcher {\n  public static void main(final String... args) {}\n}\n');
  fs.writeFileSync(path.join(javaDir, 'Dead.java'), 'package x;\npublic class Dead {\n  void helper() {}\n}\n');
  fs.writeFileSync(path.join(javaDir, 'Tool.kt'), 'package x\nfun main(args: Array<String>) {}\n');

  const result = runCliRaw(['audit-overview', '--cwd', root, '--cache-dir', path.join(root, '.cache'), '--json', '--quiet']);
  assert.strictEqual(result.status, 0, result.stderr);
  const modules = JSON.parse(result.stdout).orphans.samples.modules.map((f) => path.basename(f));
  assert(modules.includes('Dead.java'), `a class with no main and no importers is an orphan, got ${JSON.stringify(modules)}`);
  for (const entry of ['Main.java', 'Launcher.java', 'Tool.kt']) {
    assert(!modules.includes(entry), `${entry} has a main function and must not be an orphan, got ${JSON.stringify(modules)}`);
  }
} finally {
  cleanupTempDir(root);
}
