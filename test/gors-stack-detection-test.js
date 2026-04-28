#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-gors-'));
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

const cli = path.join(process.cwd(), 'cli.js');
const summary = spawnSync('node', [cli, 'audit-summary', '--cwd', dir, '--json', '--quiet'], { encoding: 'utf8' });
const diff = spawnSync('node', [cli, 'audit-diff', '--cwd', dir, '--json', '--quiet'], { encoding: 'utf8' });

const s = JSON.parse(summary.stdout);
const d = JSON.parse(diff.stdout);

assert.strictEqual(s.ok, true);
assert(s.scope.counts.totalFiles >= 4, `expected >=4 files, got ${s.scope.counts.totalFiles}`);

assert.strictEqual(d.ok, true);
assert(d.summary.counts.changedFiles >= 2, `expected >=2 changed files, got ${d.summary.counts.changedFiles}`);

assert.strictEqual(d.validationAdvice.stack.profile, 'mixed');
assert(d.validationAdvice.stack.go, 'go stack should exist');
assert.strictEqual(d.validationAdvice.stack.go.enabled, true);
assert.strictEqual(d.validationAdvice.stack.go.testRunner, 'go test');
assert(d.validationAdvice.stack.rust, 'rust stack should exist');
assert.strictEqual(d.validationAdvice.stack.rust.enabled, true);
assert.strictEqual(d.validationAdvice.stack.rust.testRunner, 'cargo test');

const cmdNames = [
  ...d.validationAdvice.commands.smoke.map(c => c.name),
  ...d.validationAdvice.commands.focused.map(c => c.name),
  ...d.validationAdvice.commands.full.map(c => c.name),
];
assert(cmdNames.includes('go-build'), 'should include go-build');
assert(cmdNames.includes('go-all-tests'), 'should include go-all-tests');
assert(cmdNames.includes('rust-check'), 'should include rust-check');
assert(cmdNames.includes('rust-all-tests'), 'should include rust-all-tests');

fs.rmSync(dir, { recursive: true, force: true });
console.log('gors-stack-detection-test: ok');
