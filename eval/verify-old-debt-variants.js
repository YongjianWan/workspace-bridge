// @semantic — Missing dynamic variants of old graph and scaling claims.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { spawnSync } = require('node:child_process');
const { DependencyGraph } = require('../src/services/dep-graph');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-old-variants-'));
const report = [];
async function graphCase(name, sources) {
  const dir = path.join(scratch, name);
  fs.mkdirSync(dir);
  for (const [file, text] of Object.entries(sources)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  }
  const graph = new DependencyGraph(dir, null, { quiet: true });
  await graph.build(Object.keys(sources).map((file) => path.join(dir, file)));
  return { dir, graph };
}
(async () => {
  const { dir, graph } = await graphCase('single-change-cycle', { 'a.js': "module.exports=require('./b');\n", 'b.js': 'module.exports=1;\n' });
  const before = graph.findCircularDependencies().length;
  fs.writeFileSync(path.join(dir, 'b.js'), "module.exports=require('./a');\n");
  await graph.updateFiles([path.join(dir, 'b.js')]);
  report.push({ id: 'single-file-new-cycle', before, after: graph.findCircularDependencies().length, expectedAfter: 1 });
  const go = await graphCase('go-unused-deletion', { 'main.go': 'package sample\nfunc Main(){}\n', 'unused.go': 'package sample\nfunc Foo(){}\n' });
  const key = go.graph.normalizeFilePath(path.join(go.dir, 'unused.go'));
  const beforeGo = go.graph.getDependencies(path.join(go.dir, 'main.go'));
  fs.unlinkSync(path.join(go.dir, 'unused.go'));
  const update = await go.graph.updateFiles([path.join(go.dir, 'unused.go')]);
  report.push({ id: 'go-unused-deletion', beforeDependencies: beforeGo, update, graphContainsDeleted: go.graph.graph.has(key), packageIndexContainsDeleted: [...go.graph.builder.goPackageIndex.values()].some((values) => values.has(key)), afterDependencies: go.graph.getDependencies(path.join(go.dir, 'main.go')) });
  for (const [language, sources, sourceFile] of [
    ['go', { 'main.go': 'package sample\nfunc Main(){ Foo() }\n', 'foo.go': 'package sample\nfunc Foo(){}\n' }, 'foo.go'],
    ['java', { 'Provider.java': 'package sample; public class Provider { public static int foo(){ return 1; } }', 'Caller.java': 'package sample; import sample.Provider; public class Caller { int bar(){return Provider.foo();} }' }, 'Provider.java'],
    ['cpp', { 'provider.h': '#ifndef P_H\n#define P_H\nint foo();\n#endif\n', 'caller.cpp': '#include "provider.h"\nint bar(){return foo();}\n' }, 'provider.h'],
  ]) {
    const c = await graphCase(`symbols-${language}`, sources);
    report.push({ id: `symbols-${language}`, expectedDirect: 1, symbolImpact: c.graph.getSymbolImpact(path.join(c.dir, sourceFile)) });
  }
  for (const count of [100, 250, 500]) {
    for (let trial = 0; trial < 2; trial++) {
      const sources = {};
      for (let i = 0; i < count; i++) sources[`C${i}.java`] = `package sample; public class C${i} { public static int value(){ return ${i ? `C${i - 1}.value()` : '1'}; } }`;
      const start = performance.now();
      const c = await graphCase(`java-${count}-${trial}`, sources);
      const edges = [...c.graph.graph.values()].reduce((total, info) => total + info.imports.length, 0);
      report.push({ id: 'java-same-package-scaling', count, trial, elapsedMs: Math.round(performance.now() - start), actualEdges: edges, expectedEdges: count - 1, rss: process.memoryUsage().rss, scope: 'Two samples per size; same-process WASM warmup and cumulative memory, not formal asymptotic proof' });
      console.log(JSON.stringify(report.at(-1)));
    }
  }
  for (const [language, sources, consumer] of [
    ['java', { 'dto/UserDto.java': 'package dto; public class UserDto {}', 'utils/ParserUtility.java': 'package utils; import dto.UserDto; public class ParserUtility { public UserDto parse(){return new UserDto();} }', 'app/Driver.java': 'package app; import utils.ParserUtility; public class Driver { ParserUtility parser = new ParserUtility(); }' }, 'utils/ParserUtility.java'],
    ['kotlin', { 'dto/UserDto.kt': 'package dto\nclass UserDto', 'utils/ParserUtility.kt': 'package utils\nimport dto.UserDto\nclass ParserUtility { fun parse(): UserDto = UserDto() }', 'app/Driver.kt': 'package app\nimport utils.ParserUtility\nclass Driver { val parser = ParserUtility() }' }, 'utils/ParserUtility.kt'],
  ]) {
    const c = await graphCase(`dto-utility-${language}`, sources);
    const dto = language === 'java' ? 'dto/UserDto.java' : 'dto/UserDto.kt';
    for (const args of [['init', '-b', 'main'], ['add', '.'], ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'initial']]) {
      const result = spawnSync('git', args, { cwd: c.dir, encoding: 'utf8' });
      if (result.status !== 0) throw new Error(result.stderr);
    }
    const cli = spawnSync(process.execPath, [path.resolve(__dirname, '../cli.js'), 'impact', '--cwd', c.dir, '--file', dto, '--max-depth', '10', '--json', '--quiet'], { encoding: 'utf8', timeout: 60000, env: { ...process.env, WB_CACHE_DIR: path.join(scratch, `cli-cache-${language}`) } });
    if (cli.error) throw cli.error;
    report.push({ id: `dto-utility-${language}`, dir: c.dir, expectedDependencies: 1, dependencies: c.graph.getDependencies(path.join(c.dir, consumer)), importRecords: c.graph.getFileInfo(path.join(c.dir, consumer)).importRecords, expectedImpact: 2, impact: c.graph.getImpactRadius(path.join(c.dir, dto), 10), unresolved: c.graph.findUnresolvedImports(), cliExit: cli.status, cliData: JSON.parse(cli.stdout.replace(/^\uFEFF/, '')) });
  }
  fs.writeFileSync(path.join(__dirname, 'truth/old-debt-variants.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report.slice(0, 5)));
})().catch((error) => { console.error(error); process.exitCode = 1; });
