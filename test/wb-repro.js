#!/usr/bin/env node
/**
 * workspace-bridge repro suite — one self-contained case per finding.
 *
 * Usage:  node wb-repro.js <path-to-workspace-bridge/cli.js> [caseId ...]
 *
 * Each case builds a throwaway git repo under the OS temp dir, runs the CLI,
 * and checks the behaviour a correct tool should have.
 *   BUG  = the defect is present (expected before the fix)
 *   OK   = behaves correctly
 * Exit code = number of BUG cases, so after fixing it doubles as a regression gate.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CLI = path.resolve(process.argv[2] || 'cli.js');
const only = new Set(process.argv.slice(3));
if (!fs.existsSync(CLI)) {
  console.error(`cli.js not found: ${CLI}`);
  process.exit(2);
}

function repo(files, { exclude = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-repro-'));
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'repro@example.com');
  git('config', 'user.name', 'repro');
  if (exclude) fs.appendFileSync(path.join(dir, '.git', 'info', 'exclude'), '.workspace-bridge/\n');
  write(dir, files);
  git('add', '-A');
  git('commit', '-qm', 'init');
  return { dir, git };
}

function write(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
}

function wb(dir, ...args) {
  const r = spawnSync(process.execPath, [CLI, ...args, '--cwd', dir, '--json', '--quiet'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  try { return JSON.parse(r.stdout); } catch { return { ok: false, error: `unparseable output: ${r.stdout.slice(0, 200)} ${r.stderr.slice(0, 200)}` }; }
}

const base = (p) => String(typeof p === 'string' ? p : p.file || '').split(/[\\/]/).pop();
const dependents = (dir, file) => (wb(dir, 'dependents', '--file', file).dependents || []).map(base).sort();
const deadExports = (dir) => (wb(dir, 'dead-exports').deadExports || []).map((e) => ({ file: base(e.file), exports: e.exports, confidence: e.confidence }));
const overview = (dir) => wb(dir, 'audit-overview');

const cases = [];
const bug = (id, title, fn) => cases.push({ id, title, fn });

// ---------------------------------------------------------------- Python
bug('PY-SUBMODULE', '`from . import mod` / `from pkg import mod` must link to pkg/mod.py, not pkg/__init__.py', () => {
  const { dir } = repo({
    'pkg/__init__.py': '',
    'pkg/target.py': 'def f():\n    return 1\n',
    'pkg/rel.py': 'from . import target\n',
    'pkg/absolute.py': 'from pkg import target\n',
  });
  const d = dependents(dir, 'pkg/target.py');
  return { pass: d.includes('rel.py') && d.includes('absolute.py'), got: d, want: ['absolute.py', 'rel.py'] };
});

bug('PY-MAIN-4KB', '`if __name__ == "__main__"` at the end of a >4KB script must mark it as an entry', () => {
  const pad = Array.from({ length: 150 }, (_, i) => `CONST_${i} = "${'x'.repeat(30)}"`).join('\n');
  const { dir } = repo({ 'tool.py': `${pad}\n\ndef main():\n    print(1)\n\nif __name__ == "__main__":\n    main()\n` });
  const d = deadExports(dir).find((e) => e.file === 'tool.py');
  return { pass: !d || !d.exports.includes('main'), got: d || 'not reported', want: 'main not reported as dead' };
});

bug('FASTAPI-16KB', 'FastAPI routes first declared after 16KB (entry pre-filter 4KB, route scan 4KB*4) must not be dead exports', () => {
  const pad = Array.from({ length: 600 }, (_, i) => `def helper_${i}():\n    return ${i}\n`).join('\n');
  const { dir } = repo({
    'requirements.txt': 'fastapi\n',
    'asr_service.py': `from fastapi import FastAPI\nfrom util import helper\napp = FastAPI()\n\n${pad}\n\n@app.get("/health")\ndef health():\n    return helper()\n`,
    'util.py': 'def helper():\n    return 1\n',
    'cli.py': 'from util import helper\nhelper()\n',
  });
  // An entry file must not be reported at all. (The exports list is silently capped at 100,
  // so checking for `health` inside it would miss the defect.)
  const d = deadExports(dir).find((e) => e.file === 'asr_service.py');
  return { pass: !d, got: d ? `reported with ${d.exports.length} exports (${d.confidence})` : 'not reported', want: 'file not reported (it is a FastAPI entry)' };
});

bug('PY-ALEMBIC', 'Alembic migration upgrade/downgrade must not be high-confidence dead exports', () => {
  const { dir } = repo({
    'requirements.txt': 'alembic\n',
    'app/alembic/versions/0001_init.py': 'revision = "0001"\n\ndef upgrade():\n    pass\n\ndef downgrade():\n    pass\n',
    'app/main.py': 'from app import util\nutil.x()\n',
    'app/__init__.py': '',
    'app/util.py': 'def x():\n    return 1\n',
    'app/other.py': 'from app.util import x\n',
  });
  const d = deadExports(dir).find((e) => e.file === '0001_init.py');
  return { pass: !d || d.confidence !== 'high', got: d || 'not reported', want: 'not reported, or not high' };
});

// ---------------------------------------------------------------- language gating / coverage honesty
bug('LANG-GATE', 'A single .py file must not switch off indexing of .ts files (no root package.json)', () => {
  const { dir } = repo({
    'web/x.ts': 'export const x = 1;\n',
    'web/main.ts': 'import { x } from "./x";\nconsole.log(x);\n',
    'scripts/tool.py': 'print(1)\n',
  });
  const d = dependents(dir, 'web/x.ts');
  return { pass: d.includes('main.ts'), got: { deps: d, languages: Object.keys(overview(dir).languageSupport || {}) }, want: 'main.ts depends on x.ts' };
});

bug('UNSUPPORTED-SILENT', 'Unsupported source files (.cs) must be reported, not silently dropped with coverageRatio=1', () => {
  const { dir } = repo({
    'Assets/Scripts/Player.cs': 'public class Player {}\n',
    'Assets/Scripts/Enemy.cs': 'public class Enemy { Player p; }\n',
    'Server/app.py': 'print(1)\n',
  });
  const o = overview(dir);
  const mentioned = JSON.stringify(o.warnings || []).includes('.cs') || JSON.stringify(o.warnings || []).toLowerCase().includes('unsupported');
  const ratio = o.analysisCoverage && o.analysisCoverage.coverageRatio;
  return { pass: mentioned && ratio < 1, got: { coverageRatio: ratio, warnings: (o.warnings || []).map((w) => w.type) }, want: 'warning about .cs and coverageRatio < 1' };
});

// ---------------------------------------------------------------- JS / TS
bug('TS-WORKSPACE', 'npm/pnpm workspace package import (@acme/core) must resolve to packages/core', () => {
  const { dir } = repo({
    'package.json': JSON.stringify({ name: 'root', private: true, workspaces: ['packages/*'] }),
    'packages/core/package.json': JSON.stringify({ name: '@acme/core', main: 'src/index.ts' }),
    'packages/core/src/index.ts': 'export const core = 1;\n',
    'packages/app/package.json': JSON.stringify({ name: '@acme/app', dependencies: { '@acme/core': '*' } }),
    'packages/app/src/main.ts': 'import { core } from "@acme/core";\nconsole.log(core);\n',
  });
  const d = dependents(dir, 'packages/core/src/index.ts');
  return { pass: d.includes('main.ts'), got: d, want: ['main.ts'] };
});

bug('TS-IMPORT-TYPE', '`import type` should still produce an (type-only) edge for impact analysis', () => {
  const { dir } = repo({
    'package.json': '{"name":"t"}',
    'src/types.ts': 'export type T = number;\n',
    'src/main.ts': 'import type { T } from "./types";\nexport const v: T = 1;\n',
  });
  const d = dependents(dir, 'src/types.ts');
  return { pass: d.includes('main.ts'), got: d, want: ['main.ts'] };
});

// ---------------------------------------------------------------- Java
const javaRepo = () => repo({
  'pom.xml': '<project><modelVersion>4.0.0</modelVersion><groupId>a</groupId><artifactId>a</artifactId><version>1</version></project>',
  'src/main/java/a/svc/Helper.java': 'package a.svc;\npublic class Helper { public static int h() { return 1; } }\n',
  'src/main/java/a/svc/Service.java': 'package a.svc;\npublic class Service { public int run() { return Helper.h(); } }\n',
  'src/main/java/a/svc/Unrelated.java': 'package a.svc;\npublic class Unrelated { public int z() { return 0; } }\n',
});

bug('JAVA-SAMEPKG-CLIQUE', 'Same-package files must not all depend on each other (Unrelated has no dependents)', () => {
  const { dir } = javaRepo();
  const d = dependents(dir, 'src/main/java/a/svc/Unrelated.java');
  return { pass: d.length === 0, got: d, want: [] };
});

bug('JAVA-INCREMENTAL', 'Incremental build and cold build must give the same graph', () => {
  const { dir, git } = javaRepo();
  dependents(dir, 'src/main/java/a/svc/Helper.java'); // warm the cache
  write(dir, { 'src/main/java/a/svc/Extra.java': 'package a.svc;\npublic class Extra {}\n' });
  git('add', '-A'); git('commit', '-qm', 'extra');
  const warm = dependents(dir, 'src/main/java/a/svc/Extra.java');
  fs.rmSync(path.join(dir, '.workspace-bridge'), { recursive: true, force: true });
  const cold = dependents(dir, 'src/main/java/a/svc/Extra.java');
  return { pass: JSON.stringify(warm) === JSON.stringify(cold), got: { warm, cold }, want: 'warm === cold' };
});

bug('KT-SAMEPKG-CLIQUE', 'Kotlin shares the Java same-package clique: an unrelated class must have no dependents', () => {
  const { dir } = repo({
    'build.gradle.kts': 'plugins { kotlin("jvm") }\n',
    'src/main/kotlin/a/svc/Service.kt': 'package a.svc\n\nclass Service { fun run() = 1 }\n',
    'src/main/kotlin/a/svc/Unrelated.kt': 'package a.svc\n\nclass Unrelated\n',
  });
  const d = dependents(dir, 'src/main/kotlin/a/svc/Unrelated.kt');
  return { pass: d.length === 0, got: d, want: [] };
});

// ---------------------------------------------------------------- Go
bug('GO-TYPE-ONLY', 'A Go file that only declares types (no funcs) must still receive edges from its users', () => {
  const { dir } = repo({
    'go.mod': 'module example.com/app\n\ngo 1.22\n',
    'ui/config.go': 'package ui\n\ntype Config struct{ A int }\n',
    'ui/ui.go': 'package ui\n\nfunc NewProgram(c Config) int { return c.A }\n',
    'main.go': 'package main\n\nimport "example.com/app/ui"\n\nfunc main() {\n\tvar c ui.Config\n\t_ = ui.NewProgram(c)\n}\n',
  });
  const d = dependents(dir, 'ui/config.go');
  return { pass: d.includes('main.go') && d.includes('ui.go'), got: d, want: ['main.go', 'ui.go'] };
});

// ---------------------------------------------------------------- pytest conftest
const conftestRepo = () => repo({
  'requirements.txt': 'pytest\n',
  'app/__init__.py': '',
  'app/factory.py': 'def make():\n    return 1\n',
  'tests/conftest.py': 'import pytest\nfrom app.factory import make\n\n@pytest.fixture\ndef thing():\n    return make()\n',
  'tests/unit/test_a.py': 'def test_a(thing):\n    assert thing\n',
});
const affected = (dir, file) => (wb(dir, 'affected-tests', '--file', file).affectedTests || []).map((t) => base(t.file)).sort();

bug('PY-CONFTEST', 'Changing conftest.py must affect every test below its directory', () => {
  const { dir } = conftestRepo();
  const a = affected(dir, 'tests/conftest.py');
  return { pass: a.includes('test_a.py'), got: a, want: ['test_a.py'] };
});

bug('PY-CONFTEST-FIXTURE', 'Code used by a conftest fixture must map to the tests using it (and conftest.py is not a test)', () => {
  const { dir } = conftestRepo();
  const a = affected(dir, 'app/factory.py');
  return { pass: a.includes('test_a.py') && !a.includes('conftest.py'), got: a, want: ['test_a.py'] };
});

bug('PY-UNDECLARED-AS-LOCAL', 'Undeclared third-party imports (typing_extensions) must not be reported as "looked local"', () => {
  const { dir } = repo({
    'requirements.txt': 'requests\n',
    'app.py': 'import requests\nimport typing_extensions\nfrom util import x\n',
    'util.py': 'x = 1\n',
  });
  const samples = ((overview(dir).droppedImports || {}).samples || []).map((s) => s.specifier);
  return { pass: !samples.includes('typing_extensions'), got: samples, want: 'typing_extensions classified as external, not local' };
});

// ---------------------------------------------------------------- init
bug('INIT-GITIGNORE-BROAD', '`init` must not add unanchored patterns that hide user files (e.g. data/cache.db)', () => {
  const { dir, git } = repo({ 'a.py': 'x = 1\n', 'b.py': 'import a\n', '.gitignore': 'node_modules/\n' }, { exclude: false });
  spawnSync(process.execPath, [CLI, 'init', '--cwd', dir], { encoding: 'utf8' });
  write(dir, { 'data/cache.db': 'user data\n' });
  const status = git('status', '--porcelain', '--untracked-files=all').stdout;
  return { pass: status.includes('data/cache.db'), got: status.includes('data/cache.db') ? 'visible' : 'data/cache.db silently ignored', want: 'visible' };
});

// ---------------------------------------------------------------- C / Rust
bug('C-MAIN', 'C `main` in a file not named main.c (e.g. tools/fuzz_main.c) must not be a dead export', () => {
  const { dir } = repo({
    'Makefile': 'all:\n\tcc main.c util.c\n',
    'util.h': 'int util(void);\n',
    'util.c': '#include "util.h"\nint util(void) { return 1; }\n',
    'main.c': '#include <stdio.h>\n#include "util.h"\nint main(void) { return util(); }\n',
    'tools/fuzz_main.c': '#include "../util.h"\nint main(void) { return util(); }\n',
  });
  const d = deadExports(dir).find((e) => e.file === 'fuzz_main.c');
  return { pass: !d || !d.exports.includes('main'), got: d || 'not reported', want: 'main not dead' };
});

bug('RUST-MOD', '`mod colors;` in lib.rs must link lib.rs -> colors.rs', () => {
  const { dir } = repo({
    'Cargo.toml': '[package]\nname = "x"\nversion = "0.1.0"\nedition = "2021"\n',
    'src/lib.rs': 'pub(crate) mod colors;\npub use colors::*;\n',
    'src/colors.rs': 'pub const RED: u8 = 1;\n',
  });
  const d = dependents(dir, 'src/colors.rs');
  return { pass: d.includes('lib.rs'), got: d, want: ['lib.rs'] };
});

// ---------------------------------------------------------------- cache / determinism
bug('CACHE-DIRTIES-REPO', 'Running the tool must not leave untracked files in the user repo (git add -A would commit cache.db)', () => {
  const { dir, git } = repo({ 'a.py': 'print(1)\n' }, { exclude: false });
  overview(dir);
  const status = git('status', '--porcelain').stdout.trim();
  return { pass: status === '', got: status || '(clean)', want: '(clean)' };
});

bug('CACHE-MTIME', 'Same size + restored mtime (cp -p / rsync -a / unzip) must still be detected as a change', () => {
  const { dir } = repo({
    'package.json': '{"name":"t"}',
    'a.ts': 'export const a = 1;\n',
    'b.ts': 'export const b = 2;\n',
    'main.ts': 'import { a } from "./a";\n',
  });
  const f = path.join(dir, 'main.ts');
  const t = new Date('2020-01-01T00:00:00Z');
  fs.utimesSync(f, t, t);
  dependents(dir, 'a.ts');
  fs.writeFileSync(f, 'import { b } from "./b";\n'); // same length
  fs.utimesSync(f, t, t);
  const d = dependents(dir, 'b.ts');
  return { pass: d.includes('main.ts'), got: d, want: ['main.ts'] };
});

bug('WARN-WARM', 'Warnings (unresolved-dropped) must be identical on cold and warm runs', () => {
  const { dir } = repo({ 'app/main.py': 'import yaml\nimport requests\n', 'app/util.py': 'x = 1\n' });
  const cold = (overview(dir).warnings || []).map((w) => w.type);
  const warm = (overview(dir).warnings || []).map((w) => w.type);
  return { pass: JSON.stringify(cold) === JSON.stringify(warm), got: { cold, warm }, want: 'cold === warm' };
});

// ---------------------------------------------------------------- audit-diff
bug('DIFF-DELETED-IN-CMD', 'audit-diff must not put deleted files into the suggested lint command', () => {
  const { dir, git } = repo({
    'package.json': '{"name":"t","devDependencies":{"eslint":"*"}}',
    'eslint.config.js': 'module.exports = [];\n',
    'src/a.js': 'module.exports = 1;\n',
    'src/gone.js': 'module.exports = 2;\n',
  });
  fs.rmSync(path.join(dir, 'src/gone.js'));
  fs.writeFileSync(path.join(dir, 'src/a.js'), 'module.exports = 3;\n');
  git('add', '-A'); git('commit', '-qm', 'delete');
  const r = wb(dir, 'audit-diff', '--commits', 'HEAD~1..HEAD');
  const cmds = JSON.stringify((r.validationAdvice || {}).commands || {});
  return { pass: !cmds.includes('gone.js'), got: cmds.includes('gone.js') ? 'gone.js present in commands' : 'absent', want: 'absent' };
});

// ---------------------------------------------------------------- security / query
bug('SEC-MODEL-EVAL', '`model.eval()` (method call) must not be flagged as builtin eval()', () => {
  const { dir } = repo({ 'train.py': 'import torch\nmodel = torch.nn.Linear(1, 1)\nmodel.eval()\n' });
  const r = wb(dir, 'audit-security');
  const hits = JSON.stringify(r).includes('py-eval');
  return { pass: !hits, got: hits ? 'py-eval reported' : 'none', want: 'none' };
});

bug('SQL-FALSE-REJECT', 'Read-only queries containing words like "update" inside literals must be allowed', () => {
  const { dir } = repo({ 'a.py': 'import b\n', 'b.py': 'x = 1\n' });
  overview(dir);
  const r = wb(dir, 'query', '--sql', "SELECT count(*) AS n FROM edges WHERE source LIKE '%update%'");
  return { pass: r.ok === true, got: r.ok ? 'ok' : r.error, want: 'ok' };
});

// ---------------------------------------------------------------- run
let bugs = 0;
for (const c of cases) {
  if (only.size && !only.has(c.id)) continue;
  let res;
  try { res = c.fn(); } catch (e) { res = { pass: false, got: `threw: ${e.message}`, want: '-' }; }
  if (!res.pass) bugs++;
  console.log(`${res.pass ? 'OK ' : 'BUG'}  ${c.id.padEnd(22)} ${c.title}`);
  if (!res.pass) console.log(`       got:  ${JSON.stringify(res.got)}\n       want: ${JSON.stringify(res.want)}`);
}
console.log(`\n${bugs} bug(s) reproduced out of ${only.size || cases.length} case(s)`);
process.exit(bugs);
