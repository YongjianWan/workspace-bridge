// @contract — Wave 3 formatter & experience fixes (W3-1/2/4/5/6)
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { formatMarkdown } = require('../src/cli/formatters/human-formatters');
const { executeCommand } = require('../src/cli/repl');
const { createMockDepGraph } = require('./test-helpers');

// ---------------------------------------------------------------------------
// W3-1: stats --markdown must not emit [object Object]
// ---------------------------------------------------------------------------
{
  const result = {
    stats: {
      totalFiles: 100,
      analysisCoverage: { parsedFiles: 98, totalFiles: 100, coverageRatio: 0.98 },
      fileRoles: { entry: 1, library: 50, test: 49 },
    },
  };
  const md = formatMarkdown('stats', result);
  assert.ok(!md.includes('[object Object]'), `W3-1: stats markdown should not contain [object Object], got:\n${md}`);
  assert.ok(md.includes('parsedFiles=98'), `W3-1: nested object should be serialized, got:\n${md}`);
  assert.ok(md.includes('coverageRatio=0.98'), `W3-1: deeply nested values should be serialized, got:\n${md}`);
}

// ---------------------------------------------------------------------------
// W3-2: audit-file markdown must include validationAdvice
// ---------------------------------------------------------------------------
{
  const result = {
    file: 'src/services/container.js',
    summary: { severity: 'high' },
    impact: { impactCount: 16 },
    affectedTests: { affectedTestsCount: 18 },
    validationAdvice: {
      changeType: 'code',
      commands: { smoke: ['npm run lint'], focused: [], full: ['npm run test'] },
      phases: [{ phase: 'smoke', description: 'Quick sanity check', commands: ['npm run lint'] }],
      suggestedCommand: 'npm run test',
      fileSpecificAdvice: ['Check container lifecycle'],
    },
  };
  const md = formatMarkdown('audit-file', result);
  assert.ok(md.includes('Validation Advice'), `W3-2: audit-file markdown should include Validation Advice section, got:\n${md}`);
  assert.ok(md.includes('npm run lint'), `W3-2: markdown should include smoke commands, got:\n${md}`);
  assert.ok(md.includes('npm run test'), `W3-2: markdown should include suggested command, got:\n${md}`);
  assert.ok(md.includes('Check container lifecycle'), `W3-2: markdown should include file-specific advice, got:\n${md}`);
}

// ---------------------------------------------------------------------------
// W3-2: audit-diff markdown must include validationAdvice
// ---------------------------------------------------------------------------
{
  const result = {
    summary: { severity: 'medium', counts: { changedFiles: 3, mainlineChangedFiles: 2, affectedTests: 5 } },
    validationAdvice: {
      changeType: 'docs',
      commands: { smoke: ['git diff --check'], focused: [], full: [] },
      phases: [{ phase: 'smoke', description: 'Quick sanity check', commands: ['git diff --check'] }],
      suggestedCommand: 'git diff --check',
      topRiskActions: [],
      summary: 'No production code changes detected.',
    },
  };
  const md = formatMarkdown('audit-diff', result);
  assert.ok(md.includes('Change type'), `W3-2: audit-diff markdown should include change type, got:\n${md}`);
  assert.ok(md.includes('git diff --check'), `W3-2: audit-diff markdown should include suggested command, got:\n${md}`);
  assert.ok(md.includes('No production code changes detected'), `W3-2: audit-diff markdown should include summary, got:\n${md}`);
}

// ---------------------------------------------------------------------------
// W3-4 & W3-6: CLI help text coverage
// ---------------------------------------------------------------------------
{
  const cliSource = fs.readFileSync(path.join(__dirname, '..', 'cli.js'), 'utf8');
  assert.ok(cliSource.includes('--fail-on-findings'), 'W3-4: cli.js help text should mention --fail-on-findings');
  assert.ok(cliSource.includes('--with-history'), 'cli.js help text should mention --with-history');
  assert.ok(
    cliSource.includes('Takes precedence over --json') || cliSource.includes('overridden by --format'),
    'W3-6: cli.js should document --format precedence over --json'
  );
}

// ---------------------------------------------------------------------------
// W3-5: REPL tree / exit / quit commands
// ---------------------------------------------------------------------------
(async () => {
  const graph = createMockDepGraph({
    mode: 'stub',
    root: '/project',
    schema: {
      '/project/src/utils/path.js': {},
      '/project/src/app.js': { imports: ['/project/src/utils/path.js'] },
      '/project/src/services/core.js': { imports: ['/project/src/app.js'] },
      '/project/test/app.test.js': { imports: ['/project/src/app.js'] },
      '/project/cli.js': {},
    },
  });
  const container = {
    workspaceRoot: '/project',
    snapshot: { graph },
    depGraph: graph,
  };

  // tree structured
  const treeResult = await executeCommand(container, 'tree src/app.js', { structured: true });
  assert.ok(treeResult && !treeResult.error, `W3-5: tree should not error, got: ${JSON.stringify(treeResult)}`);
  assert.ok(treeResult.file, `W3-5: tree result should have file, got: ${JSON.stringify(treeResult)}`);
  assert.ok(treeResult.tree, `W3-5: tree result should have tree, got: ${JSON.stringify(treeResult)}`);

  // tree text
  const treeText = await executeCommand(container, 'tree src/app.js', { structured: false });
  assert.ok(treeText && treeText.includes('file:'), `W3-5: tree text should contain file:, got: ${treeText}`);

  // exit
  const exitResult = await executeCommand(container, 'exit', { structured: true });
  assert.ok(exitResult && exitResult.ok, `W3-5: exit should return ok, got: ${JSON.stringify(exitResult)}`);

  // quit
  const quitResult = await executeCommand(container, 'quit', { structured: true });
  assert.ok(quitResult && quitResult.ok, `W3-5: quit should return ok, got: ${JSON.stringify(quitResult)}`);

  // help should include tree
  const helpResult = await executeCommand(container, 'help', { structured: true });
  assert.ok(helpResult.commands.includes('tree'), `W3-5: help should list tree command, got: ${JSON.stringify(helpResult.commands)}`);

  console.log('Wave 3 formatter & experience fixes: all assertions passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
