#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..');
const cliPath = path.join(repoRoot, 'cli.js');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-bridge-audit-diff-'));

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
  });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

function commitAll(message, authorName, authorEmail) {
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: authorName,
    GIT_AUTHOR_EMAIL: authorEmail,
    GIT_COMMITTER_NAME: authorName,
    GIT_COMMITTER_EMAIL: authorEmail,
  };
  const result = spawnSync('git', ['commit', '-m', message], {
    cwd: tempRoot,
    encoding: 'utf8',
    env,
  });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
}

function writeFile(relativePath, content) {
  const fullPath = path.join(tempRoot, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

try {
  writeFile('package.json', JSON.stringify({
    name: 'audit-diff-fixture',
    version: '1.0.0',
    main: 'src/app.js',
    scripts: {
      test: 'vitest run',
    },
  }, null, 2));
  writeFile('vitest.config.js', 'export default {};\n');
  writeFile('src/util.js', [
    'ex' + 'port function helper() {',
    "  return 'ok';",
    '}',
    '',
  ].join('\n'));
  writeFile('src/app.js', [
    "im" + "port { helper } from './util';",
    '',
    'ex' + 'port function run() {',
    '  return helper();',
    '}',
    '',
  ].join('\n'));
  writeFile('src/helper-service.js', [
    'ex' + 'port function helperService() {',
    '  return 1;',
    '}',
    '',
  ].join('\n'));
  writeFile('test/app.test.js', [
    "im" + "port { run } from '../src/app';",
    '',
    'ex' + 'port function testRun() {',
    '  return run();',
    '}',
    '',
  ].join('\n'));
  writeFile('test/app.smoke.test.js', [
    'describe("app smoke", () => {',
    '  it("ok", () => {',
    '    return true;',
    '  });',
    '});',
    '',
  ].join('\n'));

  run('git', ['init'], tempRoot);
  run('git', ['config', 'user.email', 'test@example.com'], tempRoot);
  run('git', ['config', 'user.name', 'Test User'], tempRoot);
  run('git', ['add', '.'], tempRoot);
  commitAll('init', 'Test User', 'test@example.com');

  writeFile('src/util.js', [
    'ex' + 'port function helper() {',
    "  return 'v2';",
    '}',
    '',
  ].join('\n'));
  run('git', ['add', 'src/util.js'], tempRoot);
  commitAll('feature: refine util', 'Alice', 'alice@example.com');

  writeFile('src/util.js', [
    'ex' + 'port function helper() {',
    "  return 'rollback-safe';",
    '}',
    '',
  ].join('\n'));
  run('git', ['add', 'src/util.js'], tempRoot);
  commitAll('revert: util regression', 'Bob', 'bob@example.com');

  writeFile('src/util.js', [
    'ex' + 'port function helper() {',
    "  return 'changed';",
    '}',
    '',
  ].join('\n'));

  const result = run('node', [cliPath, 'audit-diff', '--cwd', tempRoot, '--json', '--quiet'], repoRoot);
  const parsed = JSON.parse(result);
  const resultWithHints = run('node', [cliPath, 'audit-diff', '--cwd', tempRoot, '--reuse-hints', 'on', '--json', '--quiet'], repoRoot);
  const parsedWithHints = JSON.parse(resultWithHints);

  assert.strictEqual(parsed.ok, true);
  assert.strictEqual(parsed.options?.reuseHints, 'off');
  assert.strictEqual(parsedWithHints.ok, true);
  assert.strictEqual(parsedWithHints.options?.reuseHints, 'on');
  assert.strictEqual(parsed.summary.counts.changedFiles, 1);
  assert.strictEqual(parsed.summary.counts.mainlineChangedFiles, 1);
  assert.strictEqual(parsed.changedFiles.length, 1);

  const changed = parsed.changedFiles[0];
  const changedWithHints = parsedWithHints.changedFiles[0];
  assert.strictEqual(changed.file.replace(/\\/g, '/'), 'src/util.js');
  assert.strictEqual(changed.classification.directoryRole, 'active');
  assert.strictEqual(changed.impactCount >= 1, true);
  assert(Array.isArray(changed.changedLineRanges), 'changedLineRanges should exist');
  assert(changed.changedLineRanges.length >= 1, 'changedLineRanges should include modified hunks');
  assert(changed.symbolImpact, 'symbolImpact should exist');
  assert(['symbol', 'file-fallback'].includes(changed.symbolImpact.mode), 'symbolImpact.mode should be valid');
  assert(Array.isArray(changed.symbolImpact.functionToDependents), 'functionToDependents should exist');
  assert(changed.symbolImpact.changedFunctionImpact, 'changedFunctionImpact should exist');
  if (changed.symbolImpact.changedFunctionImpact.mode !== 'function-symbol') {
    console.error('DIAGNOSTIC: changedFunctionImpact.mode =', changed.symbolImpact.changedFunctionImpact.mode,
      'reason =', changed.symbolImpact.changedFunctionImpact.reason,
      'actualParseMode =', changed.symbolImpact.changedFunctionImpact.actualParseMode,
      'file =', changed.file);
  }
  assert.strictEqual(changed.symbolImpact.changedFunctionImpact.mode, 'function-symbol');
  assert(changed.symbolImpact.changedFunctionImpact.changedFunctions.includes('helper'));
  assert(Array.isArray(changed.symbolImpact.changedFunctionImpact.impactedFunctionDependents));
  assert(Array.isArray(changed.symbolImpact.changedFunctionImpact.reuseHints), 'reuseHints should exist');
  assert.strictEqual(changed.symbolImpact.changedFunctionImpact.reuseHints.length, 0, 'reuseHints should be empty by default');
  assert(Array.isArray(changedWithHints.symbolImpact.changedFunctionImpact.reuseHints), 'reuseHints should exist with flag on');
  const helperHint = changedWithHints.symbolImpact.changedFunctionImpact.reuseHints.find((item) => item.function === 'helper');
  assert(helperHint, 'reuseHints should include helper');
  assert(helperHint.suggestions.some((item) => item.function === 'helperService'), 'helper should suggest helperService');
  const helperServiceHint = helperHint.suggestions.find((item) => item.function === 'helperService');
  assert(helperServiceHint?.similarityMode, 'reuse hint should include similarityMode');
  const fnTests = changed.symbolImpact.changedFunctionImpact.functionLevelAffectedTests;
  assert(fnTests, 'functionLevelAffectedTests should exist');
  assert.strictEqual(typeof fnTests.affectedTestCount, 'number');
  const helperTests = fnTests.functions.find((item) => item.function === 'helper');
  assert(helperTests, 'functionLevelAffectedTests should include helper');
  assert(helperTests.affectedTests.some((item) => item.file.replace(/\\/g, '/').endsWith('/test/app.test.js')));
  assert(helperTests.affectedTests.every((item) => item.source === 'function-level'));
  assert(
    !helperTests.affectedTests.some((item) => item.file.replace(/\\/g, '/').endsWith('/test/app.smoke.test.js')),
    'functionLevelAffectedTests should exclude naming-only heuristic tests'
  );
  assert(changed.compositeRisk, 'compositeRisk should exist');
  assert(['low', 'medium', 'high'].includes(changed.compositeRisk.level), 'compositeRisk.level should be valid');
  assert(typeof changed.compositeRisk.score === 'number', 'compositeRisk.score should be numeric');
  assert(
    changed.compositeRisk.reasons.some((reason) => reason.includes('Function-scoped impact available')),
    'compositeRisk should include function-level reasoning'
  );
  assert.strictEqual(changed.affectedTestCount >= 1, true);
  assert.strictEqual(changed.historyRisk.level, 'high');
  assert.strictEqual(changed.historyRisk.authorCount >= 3, true);
  assert.strictEqual(changed.historyRisk.revertLikeCount >= 1, true);
  assert.strictEqual(parsed.summary.counts.highHistoryRiskFiles, 1);
  assert.strictEqual(typeof parsed.summary.counts.highCompositeRiskFiles, 'number');
  assert.strictEqual(typeof parsed.summary.counts.maxCompositeRiskScore, 'number');
  assert(Array.isArray(parsed.summary.topCompositeRisks));
  assert(parsed.summary.topCompositeRisks.length >= 1);
  assert.strictEqual(typeof parsed.summary.topCompositeRisks[0].score, 'number');
  assert(changed.affectedTests.some((entry) => entry.file.replace(/\\/g, '/').endsWith('/test/app.test.js')));
  assert(changed.affectedTests.every((entry) => typeof entry.source === 'string' && entry.source.length > 0));
  assert(changed.affectedTests.some((entry) => entry.source === 'graph'));
  assert(changed.affectedTests.every((entry) => ['graph', 'heuristic'].includes(entry.source)));
  assert(Array.isArray(parsed.validationAdvice.phases));
  assert.strictEqual(parsed.validationAdvice.phases[0].phase, 'smoke');
  assert(parsed.validationAdvice.phases.some((item) => item.phase === 'focused'));
  assert(parsed.validationAdvice.phases.some((item) => item.phase === 'full'));
  assert(Array.isArray(parsed.validationAdvice.summary));
  assert(Array.isArray(parsed.validationAdvice.topRiskActions));
  assert(parsed.validationAdvice.topRiskActions.length >= 1);
  assert(typeof parsed.validationAdvice.topRiskActions[0].actions?.[0] === 'string');
  assert(parsed.validationAdvice.topRiskActions[0].evidence, 'topRiskActions should include evidence');
  assert(typeof parsed.validationAdvice.topRiskActions[0].evidence.impactCount === 'number');
  assert(Array.isArray(parsed.validationAdvice.topRiskActions[0].evidence.topImpactedSymbols));
  const topActionForChanged = parsed.validationAdvice.topRiskActions.find((item) => item.file === changed.file);
  assert(topActionForChanged, 'topRiskActions should include the changed file');
  assert.strictEqual(topActionForChanged.evidence.impactCount, changed.impactCount);
  assert.strictEqual(topActionForChanged.evidence.affectedTestCount, changed.affectedTestCount);
  const focusedCommandNames = parsed.validationAdvice.commands.focused.map((item) => item.name);
  assert(
    focusedCommandNames.includes('node-direct-tests') || focusedCommandNames.includes('node-focused-tests'),
    'focused commands should include node direct/focused tests'
  );
  assert(parsed.validationAdvice.summary.some((item) => item.kind === 'tests'));
  assert(parsed.validationAdvice.summary.some((item) => item.kind === 'review'));

  console.log('audit-diff-test: ok');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
