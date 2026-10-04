// @semantic — Independently labelled complex SCC and transitive-impact fixtures.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DependencyGraph } = require('../src/services/dep-graph');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-u22-matrix-'));
const report = [];
const deps = { a: ['b', 'c'], b: ['c'], c: ['a'], driver: ['a'] };
const formats = {
  javascript: { ext: '.js', body: (name, targets) => targets.map((t) => `const ${t} = require('./${t}');`).join('\n') + '\nmodule.exports = () => 1;\n' },
  typescript: { ext: '.ts', body: (name, targets) => targets.map((t) => `import { value as ${t} } from './${t}';`).join('\n') + '\nexport function value(){ return 1; }\n' },
  python: { ext: '.py', body: (name, targets) => targets.map((t) => `import ${t}`).join('\n') + '\ndef value():\n    return 1\n' },
  java: { ext: '.java', body: (name, targets) => 'package sample;\n' + targets.map((t) => `import sample.${t};`).join('\n') + `\npublic class ${name} { public static int value(){ return ${targets.map((t) => `${t}.value()`).join(' + ') || '1'}; } }\n` },
  kotlin: { ext: '.kt', body: (name, targets) => 'package sample\n' + targets.map((t) => `import sample.${t}`).join('\n') + `\nobject ${name} { fun value(): Int = ${targets.map((t) => `${t}.value()`).join(' + ') || '1'} }\n` },
  cpp: { ext: '.h', body: (name, targets) => `#ifndef TRUTH_${name.toUpperCase()}\n#define TRUTH_${name.toUpperCase()}\n` + targets.map((t) => `#include "${t}.h"`).join('\n') + '\n#endif\n' },
  vue: { ext: '.vue', body: (name, targets) => '<script>\n' + targets.map((t) => `import ${t} from './${t}.vue';`).join('\n') + '\nexport default {};\n</script>\n<template><div /></template>\n' },
  svelte: { ext: '.svelte', body: (name, targets) => '<script>\n' + targets.map((t) => `import ${t} from './${t}.svelte';`).join('\n') + '\n</script>\n<div />\n' },
  go: { ext: '.go', filename: (name) => `${name}/${name}.go`, body: (name, targets) => `package ${name}\n` + targets.map((t) => `import "example.com/truth/${t}"`).join('\n') + `\nfunc Value() int { return ${targets.map((t) => `${t}.Value()`).join(' + ') || '1'} }\n` },
  rust: { ext: '.rs', body: (name, targets) => targets.map((t) => `use crate::${t};`).join('\n') + `\npub fn value()->i32 { ${targets.map((t) => `${t}::value()`).join(' + ') || '1'} }\n` },
};
(async () => {
  for (const [lang, format] of Object.entries(formats)) {
    const dir = path.join(scratch, lang);
    fs.mkdirSync(dir);
    const filename = (name) => format.filename ? format.filename(name) : name + format.ext;
    const files = [];
    if (lang === 'go') fs.writeFileSync(path.join(dir, 'go.mod'), 'module example.com/truth\ngo 1.22\n');
    if (lang === 'rust') {
      fs.writeFileSync(path.join(dir, 'Cargo.toml'), '[package]\nname="truth"\nversion="0.1.0"\nedition="2021"\n[lib]\npath="lib.rs"\n');
      fs.writeFileSync(path.join(dir, 'lib.rs'), 'pub mod a; pub mod b; pub mod c; pub mod driver;\n');
      files.push(path.join(dir, 'lib.rs'));
    }
    for (const [name, targets] of Object.entries(deps)) {
      const file = path.join(dir, filename(name));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, format.body(name, targets));
      files.push(file);
    }
    const graph = new DependencyGraph(dir, null, { quiet: true });
    try {
      await graph.build(files);
      const expected = Object.entries(deps).flatMap(([from, targets]) => targets.map((to) => `${filename(from)} -> ${filename(to)}`));
      const relative = (file) => path.relative(dir, graph._displayPath?.(file) || file).replaceAll('\\', '/');
      const actual = Object.keys(deps).flatMap((name) => graph.getDependencies(path.join(dir, filename(name))).map((target) => `${filename(name)} -> ${relative(target)}`));
      const missing = expected.filter((edge) => !actual.includes(edge));
      const extra = actual.filter((edge) => !expected.includes(edge));
      const cycles = graph.findCircularDependencies();
      const cycleMembers = [...new Set(cycles.flat().map(relative))].sort();
      const impact = graph.getImpactRadius(path.join(dir, filename('c')), 10);
      const actualImpact = impact.map((item) => relative(item.file)).sort();
      const expectedImpact = ['a', 'b', 'driver'].map(filename).concat(lang === 'rust' ? ['lib.rs'] : []).sort();
      report.push({ lang, expected, actual, missing, extra, precision: actual.length ? (actual.length - extra.length) / actual.length : 0, recall: (expected.length - missing.length) / expected.length, cycles, cycleMembers, expectedCycleMembers: ['a', 'b', 'c'].map(filename).sort(), actualImpact, expectedImpact, unresolved: graph.findUnresolvedImports(), cycleMeta: graph.getCycleMeta() });
    } catch (error) { report.push({ lang, error: error.stack }); }
    console.log(JSON.stringify(report.at(-1)));
  }
  fs.writeFileSync(path.join(__dirname, 'truth/u22-graph-matrix.json'), JSON.stringify({ scratch, scope: 'Frozen synthetic direct graph, complex 3-node SCC and depth-10 reverse closure; not complete real-repository truth', cases: report }, null, 2) + '\n');
})().catch((error) => { console.error(error); process.exitCode = 1; });
