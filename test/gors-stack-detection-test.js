#!/usr/bin/env node
// @semantic
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { runCliInProcess, makeTempDir, cleanupTempDir } = require('./test-helpers');

async function main() {
  const dir = makeTempDir('wb-gors-');
  const write = (rel, content) => {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  };

  write('go.mod', 'module example.com/demo\n\ngo 1.22\n');
  write('Cargo.toml', '[package]\nname = "demo"\nversion = "0.1.0"\nedition = "2021"\n');
  write('src/main.go', 'package main\n\nimport "fmt"\n\nfunc main() { fmt.Println(Hello()) }\n\nfunc Hello() string { return "hi" }\n');
  write('src/lib.rs', 'pub fn hello() -> String { String::from("hi") }\n');
  write('src/main.rs', 'mod lib;\nfn main() { println!("{}", lib::hello()); }\n');
  write('src/app_test.go', 'package main\nimport "testing"\nfunc TestHello(t *testing.T) { if Hello() != "hi" { t.Fail() } }\n');

  spawnSync('git', ['init'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  spawnSync('git', ['add', '.'], { cwd: dir });
  spawnSync('git', ['commit', '-m', 'init'], { cwd: dir });

  write('src/main.go', 'package main\n\nimport "fmt"\n\nfunc main() { fmt.Println(Hello()) }\n\nfunc Hello() string { return "hello" }\n');
  write('src/lib.rs', 'pub fn hello() -> String { String::from("hello") }\n');

  try {
    const s = await runCliInProcess(['audit-summary', '--cwd', dir, '--json', '--quiet']);
    const d = await runCliInProcess(['audit-diff', '--cwd', dir, '--json', '--quiet']);

    assert.strictEqual(s.ok, true);
    assert(s.scope.counts.totalFiles >= 4, `expected >=4 files, got ${s.scope.counts.totalFiles}`);

    assert.strictEqual(d.ok, true);
    assert(d.summary.counts.changedFiles >= 2, `expected >=2 changed files, got ${d.summary.counts.changedFiles}`);

    assert.strictEqual(d.validationAdvice.stack.profile, 'mixed');
    assert(d.validationAdvice.stack.go, 'go stack should exist');
    assert(d.validationAdvice.stack.rust, 'rust stack should exist');
  } finally {
    cleanupTempDir(dir);
  }
}

main();
