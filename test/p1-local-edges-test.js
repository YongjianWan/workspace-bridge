// @semantic
// @slow
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { WorkspaceCache } = require('../src/services/cache');
const { DependencyGraph } = require('../src/services/dep-graph');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

async function main() {
  const root = makeTempDir('wb-local-edges-');
  const files = {
    'pkg/__init__.py': '', 'pkg/a.py': 'a = 1', 'pkg/b.py': 'b = 1',
    'consumer.py': 'from pkg import a, b',
    '中.py': 'value = 1',
    'gbk.py': Buffer.concat([Buffer.from('# coding: gbk\nimport '), Buffer.from([0xd6, 0xd0]), Buffer.from('\n')]),
    'utf8-importer.py': 'import 中',
    'dynamic.py': 'import importlib\nimportlib.import_module("pkg.a")\n__import__("pkg.b")\nimportlib.import_module(module_name)',
    'loader.js': 'const plugins = import.meta.glob("./plugins/*.js"); require(moduleName);',
    'plugins/plugin.js': 'export const run = () => 1;',
    'webpack.config.js': 'module.exports = { entry: ["./plugins/plugin.js"] };',
    'pkg/relative.py': 'from . import a, b',
    'ns/a.py': 'a = 1', 'ns/b.py': 'b = 1', 'namespace.py': 'from ns import a, b',
    'go.work': 'go 1.22\nuse (\n ./a\n ./b\n)\n',
    'a/go.mod': 'module example.com/a\ngo 1.22\n',
    'a/util/util.go': 'package util\nfunc Hello() {}',
    'b/go.mod': 'module example.com/b\ngo 1.22\n',
    'b/main.go': 'package main\nimport "example.com/a/util"\nfunc main(){util.Hello()}',
    'java/utils/ParserUtility.java': 'package utils; import dto.UserDto; public class ParserUtility { UserDto user; }',
    'java/dto/UserDto.java': 'package dto; public class UserDto {}',
    'Cargo.toml': '[package]\nname="edge_probe"\nversion="0.1.0"\nedition="2021"\n[[bin]]\nname="custom"\npath="bin/main.rs"',
    'src/main.rs': 'mod haystack; mod args; fn main() { args::run(); }',
    'src/haystack.rs': 'pub fn build() {}',
    'src/args.rs': 'use crate::haystack; pub fn run() { haystack::build(); }',
    'bin/main.rs': 'mod a; mod b; fn main() {}',
    'bin/a.rs': 'use crate::b; pub fn run() { b::run(); }',
    'bin/b.rs': 'use crate::a; pub fn run() {}',
  };
  const cache = new WorkspaceCache(root, { cacheDir: path.join(root, '.cache') });
  try {
    for (const [file, content] of Object.entries(files)) {
      const absolute = path.join(root, file);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, content);
    }
    const inputs = Object.keys(files).filter(file => /\.(py|go|java|rs|js)$/.test(file)).reverse().map(file => path.join(root, file));
    const graph = new DependencyGraph(root, cache, { quiet: true });
    await graph.build(inputs);
    const checks = [
      ['consumer.py', 'pkg/a.py'], ['consumer.py', 'pkg/b.py'],
      ['pkg/relative.py', 'pkg/a.py'], ['pkg/relative.py', 'pkg/b.py'],
      ['namespace.py', 'ns/a.py'], ['namespace.py', 'ns/b.py'],
      ['b/main.go', 'a/util/util.go'], ['java/utils/ParserUtility.java', 'java/dto/UserDto.java'],
      ['src/main.rs', 'src/haystack.rs'], ['src/args.rs', 'src/haystack.rs'],
      ['bin/a.rs', 'bin/b.rs'], ['bin/b.rs', 'bin/a.rs'],
      ['dynamic.py', 'pkg/a.py'], ['dynamic.py', 'pkg/b.py'], ['loader.js', 'plugins/plugin.js'],
      ['gbk.py', '中.py'], ['utf8-importer.py', '中.py'],
    ];
    let failed = 0;
    for (const [source, target] of checks) {
      const dependencies = graph.getDependencies(path.join(root, source));
      try { assert(dependencies.includes(graph.normalizeFilePath(path.join(root, target))), `${source} -> ${target}`); }
      catch (error) { failed++; console.error(error.message); }
    }
    const keys = [...graph.graph.keys()];
    try {
      const warning = graph.buildWarnings().find(w => w.type === 'dynamic-load-unresolved');
      assert(warning, 'nonliteral module loads require a warning');
      assert(warning.sampleFiles.some(file => file.endsWith('dynamic.py')), 'warning must identify dynamic source files');
      assert(warning.sampleFiles.some(file => file.endsWith('webpack.config.js')), 'configured runtime entry points require an explicit incomplete-graph warning');
    }
    catch (error) { failed++; console.error(error.message); }
    try { assert.deepStrictEqual(keys, [...keys].sort(), 'graph insertion order must be deterministic'); }
    catch (error) { failed++; console.error(error.message); }
    console.log(`local edge contracts: ${checks.length + 2 - failed}/${checks.length + 2} passed`);
    assert.strictEqual(failed, 0);
  } finally { cache.close(); cleanupTempDir(root); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
