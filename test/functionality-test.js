#!/usr/bin/env node
/**
 * CLI 功能可用性测试
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..');
const cliPath = path.join(repoRoot, 'cli.js');

function runCli(args) {
  const result = spawnSync('node', [cliPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function runCliText(args) {
  const result = spawnSync('node', [cliPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

function runInDir(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
  });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

function main() {
  console.log('=== workspace-bridge CLI 功能可用性测试 ===\n');

  // Ensure audit-diff has at least one changed file to detect.
  // Use a temporary untracked file instead of modifying README.md to avoid
  // dirtying the git worktree if the test is killed mid-flight.
  const tempChangeFile = path.join(repoRoot, 'test-audit-diff-temp.txt');
  fs.writeFileSync(tempChangeFile, 'temp\n', 'utf8');

  try {

  const workspaceInfo = runCli(['workspace-info', '--cwd', '.', '--json', '--quiet']);
  assert.strictEqual(workspaceInfo.workspaceRoot, repoRoot);
  console.log('workspace-info: ok');

  const health = runCli(['health', '--cwd', '.', '--json', '--quiet']);
  assert.strictEqual(health.ok, true);
  console.log('health: ok');

  const summary = runCli(['audit-summary', '--cwd', '.', '--json', '--quiet']);
  assert.strictEqual(summary.ok, true);
  assert(summary.scope.counts.totalFiles >= 1);
  console.log('audit-summary: ok');

  const fileAudit = runCli(['audit-file', '--cwd', '.', '--file', 'src/services/container.js', '--json', '--quiet']);
  assert.strictEqual(fileAudit.ok, true);
  assert(fileAudit.impact.impactCount >= 0);
  console.log('audit-file: ok');

  const diffAudit = runCli(['audit-diff', '--cwd', '.', '--json', '--quiet']);
  assert.strictEqual(diffAudit.ok, true);
  assert(diffAudit.summary.counts.changedFiles >= 0, 'audit-diff should work on clean worktree');
  assert(diffAudit.validationAdvice.stack.profile);
  assert(Array.isArray(diffAudit.validationAdvice.topRiskActions));
  assert(typeof diffAudit.summary.counts.highCompositeRiskFiles === 'number');
  assert(typeof diffAudit.summary.counts.maxCompositeRiskScore === 'number');
  console.log('audit-diff: ok');

  const diffHuman = runCliText(['audit-diff', '--cwd', '.', '--quiet']);
  assert(diffHuman.includes('topCompositeRisk:'), 'audit-diff human output should include topCompositeRisk');
  assert(diffHuman.includes('topRiskAction:'), 'audit-diff human output should include topRiskAction');
  assert(diffHuman.includes('topRiskCommand:'), 'audit-diff human output should include topRiskCommand');

  // Mixed repo stack detection
  {
    const fs = require('fs');
    const os = require('os');
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-cli-mixed-'));
    const write = (rel, content) => {
      const full = path.join(tempRoot, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf8');
    };
    write('package.json', JSON.stringify({ name: 'mixed-test', version: '1.0.0', scripts: { test: 'vitest' } }, null, 2));
    write('package-lock.json', '{}');
    write('vitest.config.js', 'export default {};');
    write('requirements.txt', 'fastapi\npytest\n');
    write('pytest.ini', '[pytest]\n');
    write('src/app.js', 'export const run = () => 1;\n');
    write('api/main.py', 'def app():\n    return 1\n');
    write('src/app.test.js', 'import { run } from "./app";\n');
    runInDir('git', ['init'], tempRoot);
    runInDir('git', ['config', 'user.email', 'test@example.com'], tempRoot);
    runInDir('git', ['config', 'user.name', 'Test User'], tempRoot);
    runInDir('git', ['add', '.'], tempRoot);
    runInDir('git', ['commit', '-m', 'init'], tempRoot);
    write('src/app.js', 'export const run = () => 2;\n');
    write('api/main.py', 'def app():\n    return 2\n');
    const mixedDiff = runCli(['audit-diff', '--cwd', tempRoot, '--json', '--quiet']);
    assert.strictEqual(mixedDiff.validationAdvice.stack.profile, 'mixed');
    assert.strictEqual(mixedDiff.validationAdvice.stack.node.testRunner, 'vitest');
    assert.strictEqual(mixedDiff.validationAdvice.stack.python.testRunner, 'pytest');
    assert.strictEqual(mixedDiff.validationAdvice.stack.python.framework, 'fastapi');
    const commandNames = [
      ...mixedDiff.validationAdvice.commands.smoke.map((c) => c.name),
      ...mixedDiff.validationAdvice.commands.focused.map((c) => c.name),
      ...mixedDiff.validationAdvice.commands.full.map((c) => c.name),
    ];
    assert(commandNames.includes('node-all-tests'));
    assert(commandNames.includes('python-all-tests'));
    fs.rmSync(tempRoot, { recursive: true, force: true });
    console.log('mixed-stack-detection: ok');
  }

  // Python framework detection: Flask from pyproject, Django should take priority when manage.py exists
  {
    const fs = require('fs');
    const os = require('os');

    const flaskRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-cli-flask-'));
    const writeFlask = (rel, content) => {
      const full = path.join(flaskRoot, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf8');
    };
    writeFlask('pyproject.toml', '[project]\nname = "flask-app"\ndependencies = ["flask>=3.0", "pytest"]\n');
    writeFlask('pytest.ini', '[pytest]\n');
    writeFlask('app/main.py', 'def app():\n    return 1\n');
    runInDir('git', ['init'], flaskRoot);
    runInDir('git', ['config', 'user.email', 'test@example.com'], flaskRoot);
    runInDir('git', ['config', 'user.name', 'Test User'], flaskRoot);
    runInDir('git', ['add', '.'], flaskRoot);
    runInDir('git', ['commit', '-m', 'init'], flaskRoot);
    writeFlask('app/main.py', 'def app():\n    return 2\n');
    const flaskDiff = runCli(['audit-diff', '--cwd', flaskRoot, '--json', '--quiet']);
    assert.strictEqual(flaskDiff.validationAdvice.stack.profile, 'python-first');
    assert.strictEqual(flaskDiff.validationAdvice.stack.python.framework, 'flask');
    fs.rmSync(flaskRoot, { recursive: true, force: true });

    const djangoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-cli-django-'));
    const writeDjango = (rel, content) => {
      const full = path.join(djangoRoot, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf8');
    };
    writeDjango('manage.py', '#!/usr/bin/env python\n');
    writeDjango('requirements.txt', 'flask\npytest\n');
    writeDjango('pytest.ini', '[pytest]\n');
    writeDjango('app/views.py', 'def index():\n    return 1\n');
    runInDir('git', ['init'], djangoRoot);
    runInDir('git', ['config', 'user.email', 'test@example.com'], djangoRoot);
    runInDir('git', ['config', 'user.name', 'Test User'], djangoRoot);
    runInDir('git', ['add', '.'], djangoRoot);
    runInDir('git', ['commit', '-m', 'init'], djangoRoot);
    writeDjango('app/views.py', 'def index():\n    return 2\n');
    const djangoDiff = runCli(['audit-diff', '--cwd', djangoRoot, '--json', '--quiet']);
    assert.strictEqual(djangoDiff.validationAdvice.stack.python.framework, 'django');
    fs.rmSync(djangoRoot, { recursive: true, force: true });
    console.log('python-framework-detection: ok');
  }

  // Polyglot symbol-level impact (JS/Python/Java)
  {
    const fs = require('fs');
    const os = require('os');
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-cli-polyglot-'));
    const write = (rel, content) => {
      const full = path.join(tempRoot, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf8');
    };
    write('package.json', JSON.stringify({ name: 'polyglot-test', version: '1.0.0' }, null, 2));
    write('requirements.txt', 'fastapi\npytest\n');
    write('pytest.ini', '[pytest]\n');
    write('pom.xml', '<project><modelVersion>4.0.0</modelVersion><groupId>com.example</groupId><artifactId>polyglot</artifactId><version>1.0.0</version></project>');
    write('mvnw', '#!/bin/sh\necho mvnw\n');
    write('src/util.js', 'export function utilFn() { return 1; }\n');
    write('src/index.js', 'import { utilFn } from "./util";\nexport function run() { return utilFn(); }\n');
    write('api/util.py', 'def helper():\n    return 1\n');
    write('api/app.py', 'from .util import helper\n\ndef run():\n    return helper()\n');
    write('src/main/java/com/example/Util.java', 'package com.example;\npublic class Util { public static int value() { return 1; } }\n');
    write('src/main/java/com/example/App.java', 'package com.example;\nimport com.example.Util;\npublic class App { public int run() { return Util.value(); } }\n');
    write('src/test/java/com/example/AppTest.java', 'package com.example;\nimport com.example.App;\npublic class AppTest { public int run() { return new App().run(); } }\n');
    runInDir('git', ['init'], tempRoot);
    runInDir('git', ['config', 'user.email', 'test@example.com'], tempRoot);
    runInDir('git', ['config', 'user.name', 'Test User'], tempRoot);
    runInDir('git', ['add', '.'], tempRoot);
    runInDir('git', ['commit', '-m', 'init'], tempRoot);
    write('src/util.js', 'export function utilFn() { return 2; }\n');
    write('api/util.py', 'def helper():\n    return 2\n');
    write('src/main/java/com/example/Util.java', 'package com.example;\npublic class Util { public static int value() { return 2; } }\n');
    const polyDiff = runCli(['audit-diff', '--cwd', tempRoot, '--json', '--quiet']);
    assert.strictEqual(polyDiff.ok, true);
    assert(Array.isArray(polyDiff.changedFiles));
    const byFile = new Map(polyDiff.changedFiles.map((entry) => [entry.file.replace(/\\/g, '/'), entry]));
    const jsEntry = byFile.get('src/util.js');
    const pyEntry = byFile.get('api/util.py');
    const javaEntry = byFile.get('src/main/java/com/example/Util.java');
    assert(jsEntry?.symbolImpact, 'js symbolImpact should exist');
    assert(pyEntry?.symbolImpact, 'python symbolImpact should exist');
    assert(javaEntry?.symbolImpact, 'java symbolImpact should exist');
    assert(Array.isArray(jsEntry.symbolImpact.symbolToDependents));
    assert(Array.isArray(jsEntry.symbolImpact.functionToDependents));
    assert(jsEntry.symbolImpact.changedFunctionImpact, 'changedFunctionImpact should exist');
    if (jsEntry.symbolImpact.changedFunctionImpact.mode !== 'function-symbol') {
      console.error('DIAGNOSTIC: changedFunctionImpact.mode =', jsEntry.symbolImpact.changedFunctionImpact.mode,
        'reason =', jsEntry.symbolImpact.changedFunctionImpact.reason,
        'actualParseMode =', jsEntry.symbolImpact.changedFunctionImpact.actualParseMode,
        'file =', jsEntry.file);
    }
    assert(jsEntry.symbolImpact.changedFunctionImpact.functionLevelAffectedTests, 'functionLevelAffectedTests should exist');
    assert.strictEqual(
      typeof jsEntry.symbolImpact.changedFunctionImpact.functionLevelAffectedTests.affectedTestsCount,
      'number'
    );
    assert(Array.isArray(jsEntry.changedLineRanges), 'changedLineRanges should exist');
    const jsSymbolRow = jsEntry.symbolImpact.symbolToDependents.find((item) => item.symbol === 'utilFn');
    if (!jsSymbolRow) {
      console.error('DIAGNOSTIC: symbolToDependents =', JSON.stringify(jsEntry.symbolImpact.symbolToDependents));
      console.error('DIAGNOSTIC: symbolImpact.mode =', jsEntry.symbolImpact.mode);
    }
    assert(jsSymbolRow, 'js symbol-to-dependent mapping should include utilFn');
    assert(jsSymbolRow.dependentsCount >= 1, 'utilFn should have at least one dependent');
    const jsFunctionRow = jsEntry.symbolImpact.functionToDependents.find((item) => item.function === 'utilFn');
    assert(jsFunctionRow, 'js function-level mapping should include utilFn');
    assert(jsFunctionRow.dependentsCount >= 1, 'utilFn function-level mapping should have at least one dependent');
    if (jsEntry.symbolImpact.changedFunctionImpact.mode === 'function-symbol') {
      assert(jsEntry.symbolImpact.changedFunctionImpact.changedFunctions.includes('utilFn'));
    }
    assert(polyDiff.validationAdvice.stack.java, 'java stack should exist in polyglot repo');
    assert.strictEqual(polyDiff.validationAdvice.stack.java.buildCommand, './mvnw');
    assert(jsEntry.impactCount >= 1);
    assert(pyEntry.impactCount >= 1);
    assert(javaEntry.impactCount >= 1);
    assert(javaEntry.affectedTestsCount >= 1);
    const polyCommandNames = [
      ...polyDiff.validationAdvice.commands.smoke.map((c) => c.name),
      ...polyDiff.validationAdvice.commands.focused.map((c) => c.name),
      ...polyDiff.validationAdvice.commands.full.map((c) => c.name),
    ];
    assert(polyCommandNames.includes('java-all-tests'));
    const javaAllTestCmd = polyDiff.validationAdvice.commands.full.find((c) => c.name === 'java-all-tests')?.cmd || '';
    assert(javaAllTestCmd.includes('./mvnw'), 'java commands should prefer project wrapper');
    fs.rmSync(tempRoot, { recursive: true, force: true });
    console.log('polyglot-symbol-impact: ok');
  }

  const overviewDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-overview-cli-'));
  const overviewDataFile = path.join(overviewDataDir, 'hotspots.json');
  const trendDataFile = path.join(overviewDataDir, 'stability-trend.json');
  const dashboardFile = path.join(overviewDataDir, 'overview.html');
  const overview = runCli([
    'audit-overview',
    '--cwd', '.',
    '--hotspot-data', overviewDataFile,
    '--stability-trend-data', trendDataFile,
    '--overview-dashboard', dashboardFile,
    '--trend-granularity', 'week',
    '--json',
    '--quiet',
  ]);
  assert.strictEqual(overview.ok, true);
  assert(overview.skeleton.totalFiles >= 1);
  assert(overview.aggregates, 'overview aggregates should exist');
  assert(overview.architectureAdvice, 'overview architectureAdvice should exist');
  assert(Array.isArray(overview.architectureAdvice.cycleRefactorSuggestions), 'overview cycle suggestions should exist');
  assert(Array.isArray(overview.architectureAdvice.couplingSplitSuggestions), 'overview coupling suggestions should exist');
  assert.strictEqual(overview.options?.hotspotData?.enabled, true);
  assert.strictEqual(overview.options?.stabilityTrendData?.enabled, true);
  assert.strictEqual(overview.options?.stabilityTrendData?.granularity, 'week');
  assert.strictEqual(overview.options?.overviewDashboard?.enabled, true);
  assert.strictEqual(overview.hotspotDataFile, overviewDataFile);
  assert.strictEqual(overview.stabilityTrendDataFile, trendDataFile);
  assert.strictEqual(overview.overviewDashboardFile, dashboardFile);
  assert(fs.existsSync(overviewDataFile), 'audit-overview should write hotspot data file');
  assert(fs.existsSync(trendDataFile), 'audit-overview should write stability trend data file');
  assert(fs.existsSync(dashboardFile), 'audit-overview should write dashboard html file');
  const overviewData = JSON.parse(fs.readFileSync(overviewDataFile, 'utf8'));
  assert.strictEqual(overviewData.schemaVersion, '1.1.1');
  assert(Array.isArray(overviewData.hotspots));
  const trendData = JSON.parse(fs.readFileSync(trendDataFile, 'utf8'));
  assert.strictEqual(trendData.schemaVersion, '1.1.1');
  assert.strictEqual(trendData.granularity, 'week');
  assert(Array.isArray(trendData.series));
  const dashboardHtml = fs.readFileSync(dashboardFile, 'utf8');
  assert(dashboardHtml.includes('Workspace Overview Dashboard'));
  assert.strictEqual(typeof overview.stabilityTrend?.latest?.stabilityScore, 'number');
  assert.strictEqual(typeof overview.stabilityTrend?.latest?.fragileCount, 'number');
  fs.rmSync(overviewDataDir, { recursive: true, force: true });
  const overviewHuman = runCliText(['audit-overview', '--cwd', '.', '--quiet']);
  assert(overviewHuman.includes('hotspotsHigh:'), 'audit-overview human output should include hotspot aggregates');
  console.log('audit-overview: ok');

  // Non-ASCII path regression check
  {
    const fs = require('fs');
    const os = require('os');
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-cli-cn-'));
    const write = (rel, content) => {
      const full = path.join(tempRoot, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf8');
    };
    write('package.json', JSON.stringify({ name: 'cn-test', version: '1.0.0', main: 'src/index.js' }, null, 2));
    write('src/模块.js', 'export function 你好() { return 42; }\n');
    write('src/index.js', 'import { 你好 } from "./模块";\nexport function main() { return 你好(); }\n');
    const cnUnresolved = runCli(['unresolved', '--cwd', tempRoot, '--json', '--quiet']);
    const cnImpact = runCli(['impact', '--cwd', tempRoot, '--file', 'src/模块.js', '--json', '--quiet']);
    assert.strictEqual(cnUnresolved.unresolvedCount, 0);
    assert.strictEqual(cnImpact.impactCount, 1);
    fs.rmSync(tempRoot, { recursive: true, force: true });
    console.log('non-ascii-paths: ok');
  }

  // Heuristic test mapping: tests without explicit imports should still be suggested
  {
    const fs = require('fs');
    const os = require('os');
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-cli-heuristic-'));
    const write = (rel, content) => {
      const full = path.join(tempRoot, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf8');
    };
    write('package.json', JSON.stringify({ name: 'heuristic-test', version: '1.0.0' }, null, 2));
    write('src/order-service.js', 'export function calc() { return 1; }\n');
    write('test/order-service.test.js', 'describe("order", () => { it("ok", () => {}); });\n');
    const affected = runCli(['affected-tests', '--cwd', tempRoot, '--file', 'src/order-service.js', '--json', '--quiet']);
    assert(affected.affectedTestsCount >= 1, 'heuristic mapping should find same-stem test file');
    fs.rmSync(tempRoot, { recursive: true, force: true });
    console.log('heuristic-test-mapping: ok');
  }

  // affected-tests human-readable should show via chain (symmetric with impact)
  {
    const fs = require('fs');
    const os = require('os');
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-cli-affected-via-'));
    const write = (rel, content) => {
      const full = path.join(tempRoot, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf8');
    };
    write('package.json', JSON.stringify({ name: 'via-test', version: '1.0.0' }, null, 2));
    write('src/lib.js', 'export function helper() { return 1; }\n');
    write('src/mid.js', 'import { helper } from "./lib.js";\nexport function mid() { return helper(); }\n');
    write('test/mid.test.js', 'import { mid } from "../src/mid.js";\ndescribe("mid", () => { it("works", () => {}); });\n');
    const text = runCliText(['affected-tests', '--cwd', tempRoot, '--file', 'src/lib.js']);
    assert(text.includes('via'), `affected-tests human-readable should show via chain, got:\n${text}`);
    fs.rmSync(tempRoot, { recursive: true, force: true });
    console.log('affected-tests-via-human: ok');
  }

  const deadExports = runCli(['dead-exports', '--cwd', '.', '--json', '--quiet']);
  assert.strictEqual(deadExports.ok, true);
  assert(Array.isArray(deadExports.deadExports));
  console.log('dead-exports: ok');

  const unresolved = runCli(['unresolved', '--cwd', '.', '--json', '--quiet']);
  assert.strictEqual(unresolved.ok, true);
  assert(Array.isArray(unresolved.unresolved));
  console.log('unresolved: ok');

  const cycles = runCli(['cycles', '--cwd', '.', '--json', '--quiet']);
  assert.strictEqual(cycles.ok, true);
  assert(Array.isArray(cycles.cycles));
  console.log('cycles: ok');

  const diagnosticsQuick = runCli(['diagnostics', '--cwd', '.', '--mode', 'quick', '--json', '--quiet']);
  assert(diagnosticsQuick.checksRun >= 1, 'quick diagnostics should run at least one check');
  console.log('diagnostics-quick: ok');

    console.log('\nAll CLI functionality tests passed');
  } finally {
    try { fs.unlinkSync(tempChangeFile); } catch (e) { /* ignore if already gone */ }
  }
}

main();
