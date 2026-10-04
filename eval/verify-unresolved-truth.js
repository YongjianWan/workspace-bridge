// @semantic — Missing local targets and known builtins, independently labelled.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-unresolved-truth-'));
const cases = [
  { lang: 'javascript', sources: { 'main.js': "const fs=require('node:fs'); const dep=require('./missing'); module.exports=dep;\n" }, target: './missing', builtin: 'node:fs' },
  { lang: 'typescript', sources: { 'main.ts': "import fs from 'node:fs'; import dep from './missing'; export default dep;\n" }, target: './missing', builtin: 'node:fs' },
  { lang: 'python', sources: { 'pkg/__init__.py': '', 'main.py': 'import sys\nimport pkg.missing\n' }, target: 'pkg.missing', builtin: 'sys' },
  { lang: 'go', sources: { 'go.mod': 'module example.com/truth\ngo 1.22\n', 'main.go': 'package main\nimport "fmt"\nimport "example.com/truth/missing"\nfunc main(){fmt.Println(missing.Value())}\n' }, target: 'example.com/truth/missing', builtin: 'fmt' },
  { lang: 'rust', sources: { 'Cargo.toml': '[package]\nname="truth"\nversion="0.1.0"\nedition="2021"\n[lib]\npath="lib.rs"\n', 'lib.rs': 'use std::fs; use crate::missing; pub fn value(){missing::value();}\n' }, target: 'crate::missing', builtin: 'std::fs' },
  { lang: 'java', sources: { 'Main.java': 'package sample; import java.util.List; import sample.Missing; public class Main { Missing value; List values; }\n' }, target: 'sample.Missing', builtin: 'java.util.List' },
  { lang: 'kotlin', sources: { 'Main.kt': 'package sample\nimport kotlin.collections.List\nimport sample.Missing\nclass Main(val value: Missing, val values: List<Int>)\n' }, target: 'sample.Missing', builtin: 'kotlin.collections.List' },
  { lang: 'cpp', sources: { 'main.cpp': '#include <stdio.h>\n#include "missing.h"\nint main(){return missing();}\n' }, target: 'missing.h', builtin: 'stdio.h' },
  { lang: 'vue', sources: { 'Main.vue': '<script>\nimport fs from "node:fs"; import dep from "./missing.vue"; export default {};\n</script>\n<template><div/></template>\n' }, target: './missing.vue', builtin: 'node:fs' },
  { lang: 'svelte', sources: { 'Main.svelte': '<script>\nimport fs from "node:fs"; import dep from "./missing.svelte";\n</script>\n<div/>\n' }, target: './missing.svelte', builtin: 'node:fs' },
];
const report = [];
for (const fixture of cases) {
  const dir = path.join(scratch, fixture.lang);
  for (const [file, content] of Object.entries(fixture.sources)) { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), content); }
  const run = spawnSync(process.execPath, [path.resolve(__dirname, '../cli.js'), 'audit-overview', '--cwd', dir, '--json', '--quiet'], { env: { ...process.env, WB_CACHE_DIR: path.join(scratch, 'cache', fixture.lang) }, encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024 });
  const data = run.stdout ? JSON.parse(run.stdout.replace(/^\uFEFF/, '')) : null;
  const item = { lang: fixture.lang, truth: { missingLocalTarget: fixture.target, knownBuiltin: fixture.builtin, standaloneFixtureNoExternalDependencies: true }, exitCode: run.status, summary: data?.summary, unresolved: data?.unresolved, droppedImports: data?.droppedImports, warnings: data?.warnings, quality: data?.dataQuality, error: run.error?.message || (!data ? run.stderr : null) };
  report.push(item);
  console.log(JSON.stringify(item));
}
fs.writeFileSync(path.join(__dirname, 'truth/unresolved-truth.json'), JSON.stringify({ scope: 'Local missing target vs known builtin in each controlled language fixture; not installed-package completeness in real repositories', cases: report }, null, 2) + '\n');
