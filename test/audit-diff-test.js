#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { runInDir, makeTempDir, cleanupTempDir } = require('./test-helpers');

const repoRoot = path.join(__dirname, '..');
const cliPath = path.join(repoRoot, 'cli.js');

function commitAll(tempRoot, message, authorName, authorEmail) {
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

function main() {
  const tempRoot = makeTempDir('workspace-bridge-audit-diff-');

  function writeFile(relativePath, content) {
    const fullPath = path.join(tempRoot, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }
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
    'export function helper() {',
    "  return 'ok';",
    '}',
    '',
  ].join('\n'));
  writeFile('src/app.js', [
    "import { helper } from './util';",
    '',
    'export function run() {',
    '  return helper();',
    '}',
    '',
  ].join('\n'));
  writeFile('src/helper-service.js', [
    'export function helperService() {',
    '  return 1;',
    '}',
    '',
  ].join('\n'));
  writeFile('test/app.test.js', [
    "import { run } from '../src/app';",
    '',
    'export function testRun() {',
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

  runInDir('git', ['init'], tempRoot);
  runInDir('git', ['config', 'user.email', 'test@example.com'], tempRoot);
  runInDir('git', ['config', 'user.name', 'Test User'], tempRoot);
  runInDir('git', ['add', '.'], tempRoot);
  commitAll(tempRoot, 'init', 'Test User', 'test@example.com');

  writeFile('src/util.js', [
    'export function helper() {',
    "  return 'v2';",
    '}',
    '',
  ].join('\n'));
  runInDir('git', ['add', 'src/util.js'], tempRoot);
  commitAll(tempRoot, 'feature: refine util', 'Alice', 'alice@example.com');

  writeFile('src/util.js', [
    'export function helper() {',
    "  return 'rollback-safe';",
    '}',
    '',
  ].join('\n'));
  runInDir('git', ['add', 'src/util.js'], tempRoot);
  commitAll(tempRoot, 'revert: util regression', 'Bob', 'bob@example.com');

  writeFile('src/util.js', [
    'export function helper() {',
    "  return 'changed';",
    '}',
    '',
  ].join('\n'));

  const result = runInDir('node', [cliPath, 'audit-diff', '--cwd', tempRoot, '--json', '--quiet'], repoRoot);
  const parsed = JSON.parse(result);
  const resultWithHints = runInDir('node', [cliPath, 'audit-diff', '--cwd', tempRoot, '--reuse-hints', 'on', '--json', '--quiet'], repoRoot);
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
  assert(Array.isArray(changed.symbolImpact.changedFunctionImpact.impactedFunctionDependents), 'impactedFunctionDependents should be an array');
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
  assert(fnTests.affectedTestsCount >= 0, `functionLevelAffectedTests.affectedTestsCount should be >= 0, got ${fnTests.affectedTestsCount}`);
  const helperTests = fnTests.functions.find((item) => item.function === 'helper');
  assert(helperTests, 'functionLevelAffectedTests should include helper');
  assert(helperTests.affectedTests.some((item) => item.file.replace(/\\/g, '/').endsWith('/test/app.test.js')), 'helper affectedTests should include app.test.js');
  assert(helperTests.affectedTests.every((item) => item.source === 'function-level'), 'helper affectedTests should all be function-level');
  assert(
    !helperTests.affectedTests.some((item) => item.file.replace(/\\/g, '/').endsWith('/test/app.smoke.test.js')),
    'functionLevelAffectedTests should exclude naming-only heuristic tests'
  );
  assert(changed.compositeRisk, 'compositeRisk should exist');
  assert(['low', 'medium', 'high'].includes(changed.compositeRisk.level), 'compositeRisk.level should be valid');
  assert(changed.compositeRisk.score >= 0, `compositeRisk.score should be >= 0, got ${changed.compositeRisk.score}`);
  assert(
    changed.compositeRisk.reasons.some((reason) => reason.includes('Function-scoped impact available')),
    'compositeRisk should include function-level reasoning'
  );
  assert(changed.affectedTestsCount >= 1, `changed.affectedTestsCount should be >= 1, got ${changed.affectedTestsCount}`);
  assert.strictEqual(changed.historyRisk.level, 'high');
  assert.strictEqual(changed.historyRisk.authorCount >= 3, true);
  assert.strictEqual(changed.historyRisk.revertLikeCount >= 1, true);
  assert.strictEqual(parsed.summary.counts.highHistoryRiskFiles, 1);
  assert(parsed.summary.counts.highCompositeRiskFiles >= 0, `highCompositeRiskFiles should be >= 0, got ${parsed.summary.counts.highCompositeRiskFiles}`);
  assert(parsed.summary.counts.maxCompositeRiskScore >= 0, `maxCompositeRiskScore should be >= 0, got ${parsed.summary.counts.maxCompositeRiskScore}`);
  assert(Array.isArray(parsed.summary.topCompositeRisks), 'topCompositeRisks should be an array');
  assert(parsed.summary.topCompositeRisks.length >= 1, 'topCompositeRisks should have at least one entry');
  assert(parsed.summary.topCompositeRisks[0].score >= 0, `topCompositeRisk score should be >= 0, got ${parsed.summary.topCompositeRisks[0].score}`);
  assert(changed.affectedTests.some((entry) => entry.file.replace(/\\/g, '/').endsWith('/test/app.test.js')));
  assert(changed.affectedTests.every((entry) => typeof entry.source === 'string' && entry.source.length > 0), 'affectedTests entries should have non-empty source');
  assert(changed.affectedTests.some((entry) => entry.source === 'graph'));
  assert(changed.affectedTests.every((entry) => ['graph', 'heuristic'].includes(entry.source)));
  assert(Array.isArray(parsed.validationAdvice.phases), 'validationAdvice.phases should be an array');
  assert.strictEqual(parsed.validationAdvice.phases[0].phase, 'smoke');
  assert(parsed.validationAdvice.phases.some((item) => item.phase === 'focused'));
  assert(parsed.validationAdvice.phases.some((item) => item.phase === 'full'));
  assert(Array.isArray(parsed.validationAdvice.summary), 'validationAdvice.summary should be an array');
  assert(Array.isArray(parsed.validationAdvice.topRiskActions), 'validationAdvice.topRiskActions should be an array');
  assert(parsed.validationAdvice.topRiskActions.length >= 1, 'validationAdvice.topRiskActions should have at least one entry');
  assert(parsed.validationAdvice.topRiskActions[0].actions?.[0]?.length > 0, 'topRiskActions first action should be a non-empty string');
  assert(typeof parsed.validationAdvice.suggestedCommand === 'string' && parsed.validationAdvice.suggestedCommand.length > 0, 'validationAdvice.suggestedCommand should be a non-empty string');
  assert(parsed.validationAdvice.topRiskActions[0].evidence, 'topRiskActions should include evidence');
  assert(typeof parsed.validationAdvice.topRiskActions[0].evidence.impactCount === 'number', 'evidence.impactCount should be a number');
  assert(Array.isArray(parsed.validationAdvice.topRiskActions[0].evidence.topImpactedSymbols), 'evidence.topImpactedSymbols should be an array');
  const topActionForChanged = parsed.validationAdvice.topRiskActions.find((item) => item.file === changed.file);
  assert(topActionForChanged, 'topRiskActions should include the changed file');
  assert.strictEqual(topActionForChanged.evidence.impactCount, changed.impactCount);
  assert.strictEqual(topActionForChanged.evidence.affectedTestsCount, changed.affectedTestsCount);
  const focusedCommandNames = parsed.validationAdvice.commands.focused.map((item) => item.name);
  assert(
    focusedCommandNames.includes('node-direct-tests') || focusedCommandNames.includes('node-focused-tests'),
    'focused commands should include node direct/focused tests'
  );

  // P8-2: verify structured executable metadata on all phases
  for (const phase of ['smoke', 'focused', 'full']) {
    for (const cmd of parsed.validationAdvice.commands[phase] || []) {
      assert(cmd.executable != null, `command ${cmd.name} should have executable`);
      assert(typeof cmd.executable.command === 'string', `command ${cmd.name} should have executable.command`);
      assert(Array.isArray(cmd.executable.args), `command ${cmd.name} should have executable.args array`);
      assert(typeof cmd.executable.expectedExitCode === 'number', `command ${cmd.name} should have expectedExitCode`);
      assert(typeof cmd.executable.onFailure === 'string', `command ${cmd.name} should have onFailure`);
    }
  }
  assert(parsed.validationAdvice.summary.some((item) => item.kind === 'tests'));
  assert(parsed.validationAdvice.summary.some((item) => item.kind === 'review'));

  // Compact mode: verify curation drops heavy fields and caps arrays
  const compactResult = runInDir('node', [cliPath, 'audit-diff', '--cwd', tempRoot, '--json', '--quiet', '--compact'], repoRoot);
  const compactParsed = JSON.parse(compactResult);
  assert.strictEqual(compactParsed.ok, true);
  assert.strictEqual(compactParsed.changedFiles.length, 1);
  const compactChanged = compactParsed.changedFiles[0];
  assert.strictEqual(compactChanged.file.replace(/\\/g, '/'), 'src/util.js');
  assert(compactChanged.impact.length <= 5, `compact should cap impact to <=5, got ${compactChanged.impact.length}`);
  assert(compactChanged.affectedTests.length <= 5, `compact should cap affectedTests to <=5, got ${compactChanged.affectedTests.length}`);
  assert.strictEqual(compactChanged.symbolImpact, undefined, 'compact should drop symbolImpact');
  assert.strictEqual(compactChanged.changedLineRanges, undefined, 'compact should drop changedLineRanges');
  assert.strictEqual(compactChanged.recentCommits, undefined, 'compact should drop recentCommits');
  assert.strictEqual(compactChanged.resolvedPath, undefined, 'compact should drop resolvedPath');
  assert.strictEqual(compactChanged.historyRisk.score, changed.historyRisk.score, 'compact should keep historyRisk.score');
  assert.strictEqual(compactChanged.historyRisk.level, changed.historyRisk.level, 'compact should keep historyRisk.level');
  assert.strictEqual(compactChanged.historyRisk.recentCommits, undefined, 'compact should drop historyRisk.recentCommits');

  // --since commit range mode
  const sinceResult = runInDir('node', [cliPath, 'audit-diff', '--cwd', tempRoot, '--since', 'HEAD~2', '--json', '--quiet'], repoRoot);
  const sinceParsed = JSON.parse(sinceResult);
  assert.strictEqual(sinceParsed.ok, true, 'audit-diff --since should succeed');
  assert.strictEqual(sinceParsed.changedFiles.length >= 1, true, 'HEAD~2 should include at least src/util.js');
  assert(sinceParsed.changedFiles.some((c) => c.file.replace(/\\/g, '/').endsWith('src/util.js')), '--since HEAD~2 should include src/util.js');
  assert.strictEqual(sinceParsed.summary.counts.changedFiles >= 1, true);
  cleanupTempDir(tempRoot);
}

main();
