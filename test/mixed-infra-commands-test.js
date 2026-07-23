// @contract
// Mixed repo L1/L2 兜底命令契约（stack-detectors/commands.js + validation-advice.js）:
// - INFRA_PATTERNS 词边界：Dockerfiles/、Makefiles/ 目录不误报；
//   compose.yaml（Compose v2 官方名）、docker-compose.override.yml 不漏报
// - L1: mixed repo 无归属 infra 文件变更 → merged.full 头部插入 mixed-infra-smoke，
//   full 为空时也必须出现（不许静默丢弃——L1-4 静默降级禁令）
// - L2: 2+ 栈同时有文件变更 → merged.full 追加 cross-stack-full-tests
// - 非 mixed profile 不产生 advisory 条目
// - audit-file 单查 infra 文件：changedTargets 必须包含该文件，L1 提醒可达
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { generateCommands, INFRA_PATTERNS } = require('../src/utils/stack-detector');
const { buildFileValidationAdvice } = require('../src/cli/formatters/validation-advice');

function mixedStack(overrides = {}) {
  return {
    profile: 'mixed',
    node: { enabled: true, packageManager: 'npm', linters: [], typeChecker: null, testRunner: 'node' },
    python: { enabled: true, linters: [], typeChecker: null, testRunner: 'pytest' },
    java: null,
    go: null,
    rust: null,
    cpp: null,
    ...overrides,
  };
}

function fullNames(commands) {
  return (commands.full || []).map((c) => c.name);
}

function testInfraPatternBoundaries() {
  const cases = {
    'Dockerfile': true,
    'docker/Dockerfile.dev': true,
    'docker-compose.yml': true,
    'compose.yaml': true,
    'docker-compose.override.yml': true,
    '.env': true,
    '.env.local': true,
    'Makefile': true,
    'Jenkinsfile': true,
    '.gitlab-ci.yml': true,
    '.github/workflows/ci.yml': true,
    'Dockerfiles/notes.txt': false,
    'src/Makefiles/readme.txt': false,
    'MyJenkinsfileParser.md': false,
    'app/.envrc': false,
  };
  for (const [file, expected] of Object.entries(cases)) {
    assert.strictEqual(
      INFRA_PATTERNS.test(file), expected,
      `INFRA_PATTERNS.test('${file}') should be ${expected}`
    );
  }
}

function testL1InfraSmokePrecedesStackTests() {
  const commands = generateCommands(mixedStack(), 'code', ['src/app.js', 'Dockerfile'], []);
  const names = fullNames(commands);
  const smokeIdx = names.indexOf('mixed-infra-smoke');
  assert.ok(smokeIdx >= 0, 'mixed-infra-smoke should be in merged.full');
  const firstStackTest = names.findIndex((n) => n.endsWith('-all-tests'));
  assert.ok(firstStackTest === -1 || smokeIdx < firstStackTest, 'mixed-infra-smoke should precede stack full-test entries');
  const entry = commands.full[smokeIdx];
  assert.strictEqual(entry.executable, null, 'advisory entry has no executable');
  assert.ok(entry.description.includes('Dockerfile'), 'description lists the changed infra file');
}

function testL1FiresEvenWhenFullOtherwiseEmpty() {
  // 两栈都没有 test runner → merged.full 没有任何栈级命令；advisory 不许被静默丢弃
  const stack = mixedStack({
    node: { enabled: true, packageManager: 'npm', linters: [], typeChecker: null, testRunner: null },
    python: { enabled: true, linters: [], typeChecker: null, testRunner: null },
  });
  const commands = generateCommands(stack, 'code', ['Dockerfile'], []);
  assert.ok(fullNames(commands).includes('mixed-infra-smoke'), 'advisory must appear even when no stack contributes full commands');
}

function testL1IgnoresNonInfraUnownedFiles() {
  // 无归属但非 infra 的文件（如 .md 之外的杂项）不触发提醒
  const commands = generateCommands(mixedStack(), 'code', ['src/app.js', 'assets/logo.svg'], []);
  assert.ok(!fullNames(commands).includes('mixed-infra-smoke'), 'non-infra unowned files must not trigger the reminder');
}

function testL2CrossStackReminder() {
  const twoStacks = generateCommands(mixedStack(), 'code', ['src/app.js', 'api/main.py'], []);
  assert.ok(fullNames(twoStacks).includes('cross-stack-full-tests'), '2 stacks changed should append cross-stack reminder');

  const oneStack = generateCommands(mixedStack(), 'code', ['src/app.js'], []);
  assert.ok(!fullNames(oneStack).includes('cross-stack-full-tests'), 'single stack change must not append cross-stack reminder');
}

function testNoAdvisoryOutsideMixedProfile() {
  const stack = mixedStack({ profile: 'node-first' });
  const commands = generateCommands(stack, 'code', ['src/app.js', 'Dockerfile'], []);
  const names = fullNames(commands);
  assert.ok(!names.includes('mixed-infra-smoke'), 'non-mixed profile must not emit mixed-infra-smoke');
  assert.ok(!names.includes('cross-stack-full-tests'), 'non-mixed profile must not emit cross-stack-full-tests');
}

function testAuditFileOnInfraFileReachesL1() {
  // audit-file 单查 Dockerfile 是 L1 的头号场景：changedTargets 不得为空
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-mixed-infra-'));
  try {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0' }));
    fs.writeFileSync(path.join(root, 'requirements.txt'), 'pytest\n');
    fs.writeFileSync(path.join(root, 'Dockerfile'), 'FROM node:20\n');
    const advice = buildFileValidationAdvice(path.join(root, 'Dockerfile'), root, null, null);
    assert.ok(
      fullNames(advice.commands).includes('mixed-infra-smoke'),
      'audit-file on Dockerfile in a mixed repo must surface mixed-infra-smoke'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function main() {
  testInfraPatternBoundaries();
  testL1InfraSmokePrecedesStackTests();
  testL1FiresEvenWhenFullOtherwiseEmpty();
  testL1IgnoresNonInfraUnownedFiles();
  testL2CrossStackReminder();
  testNoAdvisoryOutsideMixedProfile();
  testAuditFileOnInfraFileReachesL1();
  console.log('mixed-infra-commands-test: all passed');
}

main();
