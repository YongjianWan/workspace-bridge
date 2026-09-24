#!/usr/bin/env node
// @semantic
// @fast
/**
 * Python manifest v2 覆盖缺口（2026-09-24 实测：串围标仓 pytest 121 条 dropped）：
 * `readPythonDeps` 只读根 `requirements.txt`，dev 依赖声明在
 * `requirements-dev.txt` 的（pytest 一族）全部漏判 → 被当本地 import 记入
 * dropped。本测试锁全量声明面：requirements-dev.txt、pyproject
 * [dependency-groups]（PEP 735 / uv）、[project] 只认 dependencies 键
 * （classifiers/keywords 不是依赖声明）。
 *
 * 安全方向与 JVM manifest v1 一致：manifest 命中只影响外部闸（dropped 记账），
 * 本地文件解析永远优先，多认一个第三方名不可能藏掉真边。
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readPythonDeps } = require('../src/services/dep-graph/resolvers/base');
const { isExternalDependency } = require('../src/services/dep-graph/resolvers');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanupTempDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function testRequirementsDevExtracted() {
  const dir = makeTempDir('wb-pyreqdev-');
  try {
    fs.writeFileSync(path.join(dir, 'requirements.txt'), 'python-docx\npyyaml\n');
    fs.writeFileSync(
      path.join(dir, 'requirements-dev.txt'),
      '-r requirements.txt\npytest\npytest-repeat==0.9.4\n'
    );
    const names = readPythonDeps(dir);
    assert(names.has('python-docx'), `runtime 声明应提取，实际: ${[...names].join(', ')}`);
    assert(names.has('pytest'), `requirements-dev.txt 的 dev 声明应提取（实测缺口），实际: ${[...names].join(', ')}`);
    assert(names.has('pytest-repeat'), `带版本约束的 dev 声明应提取，实际: ${[...names].join(', ')}`);
  } finally {
    cleanupTempDir(dir);
  }
}

function testGateSeesDevDeps() {
  const dir = makeTempDir('wb-pyreqgate-');
  try {
    fs.writeFileSync(path.join(dir, 'requirements-dev.txt'), 'pytest\n');
    assert.strictEqual(
      isExternalDependency('pytest', '.py', dir), true,
      'dev 声明的 pytest 应判外部（gate 不再把它记成 dropped）'
    );
    assert.strictEqual(
      isExternalDependency('pytest.someplugin', '.py', dir), true,
      '点号子模块归根判定（root segment 归一为连字符）'
    );
    assert.strictEqual(
      isExternalDependency('mylocalpkg', '.py', dir), false,
      '未声明的名字不许判外部（保守方向不变）'
    );
  } finally {
    cleanupTempDir(dir);
  }
}

function testDependencyGroupsExtracted() {
  const dir = makeTempDir('wb-pydepgroups-');
  try {
    fs.writeFileSync(
      path.join(dir, 'pyproject.toml'),
      [
        '[project]',
        'name = "t"',
        'classifiers = ["Framework :: Django"]',
        'dependencies = ["flask"]',
        '',
        '[project.optional-dependencies]',
        'docs = ["sphinx"]',
        '',
        '[dependency-groups]',
        'dev = ["ruff"]',
        '',
        '[tool.poetry.dev-dependencies]',
        'mypy = "^1.0"',
        '',
      ].join('\n')
    );
    const names = readPythonDeps(dir);
    assert(names.has('flask'), `[project].dependencies 应提取，实际: ${[...names].join(', ')}`);
    assert(names.has('sphinx'), `optional-dependencies 应提取，实际: ${[...names].join(', ')}`);
    assert(names.has('ruff'), `[dependency-groups]（PEP 735/uv）应提取，实际: ${[...names].join(', ')}`);
    assert(names.has('mypy'), `poetry 旧式 dev-dependencies 应提取，实际: ${[...names].join(', ')}`);
    assert(!names.has('framework'), `classifiers 不是依赖声明，不许进名单，实际: ${[...names].join(', ')}`);
  } finally {
    cleanupTempDir(dir);
  }
}

function testMtimeStampCoversDevFile() {
  const dir = makeTempDir('wb-pystamp-');
  try {
    fs.writeFileSync(path.join(dir, 'requirements.txt'), 'pyyaml\n');
    fs.writeFileSync(path.join(dir, 'requirements-dev.txt'), 'pytest\n');
    assert(readPythonDeps(dir).has('pytest'));

    // 缓存同代契约：改 requirements-dev.txt 必须使 memo 失效
    fs.writeFileSync(path.join(dir, 'requirements-dev.txt'), 'ruff\n');
    const future = new Date(Date.now() + 2000);
    fs.utimesSync(path.join(dir, 'requirements-dev.txt'), future, future);
    const names = readPythonDeps(dir);
    assert(names.has('ruff'), `dev 文件变更后必须重读，实际: ${[...names].join(', ')}`);
    assert(!names.has('pytest'), `旧 dev 声明必须随重读消失，实际: ${[...names].join(', ')}`);
  } finally {
    cleanupTempDir(dir);
  }
}

async function main() {
  testRequirementsDevExtracted();
  testGateSeesDevDeps();
  testDependencyGroupsExtracted();
  testMtimeStampCoversDevFile();
}

main().catch((err) => {
  console.error('Test failed:', err.message);
  process.exit(1);
});
