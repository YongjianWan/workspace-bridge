const path = require('path');
const { detectStack, generateCommands, enrichCommandEntry } = require('../../utils/stack-detector');
const { classifyChangeType, getValidationTemplate } = require('./audit-diff-summary');
const { collectEntryMetrics } = require('./validation-advice/metrics');
const { buildPhases } = require('./validation-advice/phases');
const { buildSummary } = require('./validation-advice/summary');
const { buildTopRiskActions, pickSuggestedCommand } = require('./validation-advice/risk-actions');

function buildValidationAdvice(entries, workspaceRoot) {
  // L2-7: zero changes should not hallucinate a docs validation plan
  if (!entries || entries.length === 0) {
    return {
      changeType: 'none',
      stack: {
        profile: 'unknown',
        packageManager: null,
        node: false,
        python: false,
        java: false,
        go: false,
        rust: false,
      },
      commands: { smoke: [], focused: [], full: [] },
      suggestedCommand: null,
      topRiskActions: [],
      phases: [],
      summary: {
        changedFiles: 0,
        mainlineChangedFiles: 0,
        affectedTests: 0,
        maxImpact: 0,
        highHistoryRiskFiles: 0,
        highCompositeRiskFiles: 0,
      },
    };
  }

  const changeType = classifyChangeType(entries);

  const stack = detectStack(workspaceRoot);
  const fileExtensions = Array.from(new Set(entries.map((e) => (e.file || '').split('.').pop()?.toLowerCase()).filter(Boolean)));
  const template = getValidationTemplate(changeType, stack.profile, fileExtensions);

  const metrics = collectEntryMetrics(entries);
  const { phases, smokeTargets, focusedSteps } = buildPhases(metrics, template);
  const summary = buildSummary(metrics);

  const commands = generateCommands(stack, changeType, smokeTargets, focusedSteps);

  const allCommands = [
    ...(commands.focused || []),
    ...(commands.smoke || []),
    ...(commands.full || []),
  ];

  const topRiskActions = buildTopRiskActions(entries, allCommands);

  return {
    changeType,
    stack: {
      profile: stack.profile,
      packageManager: stack.packageManager,
      node: stack.node,
      python: stack.python,
      java: stack.java,
      go: stack.go,
      rust: stack.rust,
    },
    commands,
    suggestedCommand: pickSuggestedCommand(allCommands),
    topRiskActions,
    phases,
    summary,
  };
}

/**
 * Lightweight validation advice for a single file (audit-file).
 * Detects stack and returns focused commands without full phase orchestration.
 */
function buildFileSpecificAdvice(ext, stackProfile) {
  const advice = [];
  if (ext === '.vue' && stackProfile === 'node-first') {
    advice.push('Verify template bindings and component prop changes are synchronized.');
  } else if (ext === '.java' && stackProfile === 'java-first') {
    advice.push('Check interface contract changes and downstream Controller/Service caller compatibility.');
  } else if (ext === '.py' && stackProfile === 'python-first') {
    advice.push('Check if model field changes require a companion migration script.');
  } else if (ext === '.go' && stackProfile === 'go-first') {
    advice.push('Verify interface changes do not break existing implementers (interface compliance).');
  } else if (ext === '.rs' && stackProfile === 'rust-first') {
    advice.push('Check trait implementation changes affect downstream dependencies (trait bound compliance).');
  }
  return advice;
}

function buildFileValidationAdvice(filePath, workspaceRoot, affectedTests) {
  const stack = detectStack(workspaceRoot);
  const ext = path.extname(filePath).toLowerCase();

  // Infer change type from extension for single-file context
  let changeType = 'code';
  if (/\.(md|rst|txt)$/.test(ext)) changeType = 'docs';
  else if (/\.(json|yaml|yml|toml)$/.test(ext)) changeType = 'config';
  else if (/\.(sh|ps1|bat)$/.test(ext)) changeType = 'scripts';

  // Route B fix: surface affected tests as direct validation targets so
  // generateCommands can emit focused test commands (vitest/pytest/go/...).
  const testFiles = (affectedTests?.affectedTests || [])
    .map((entry) => entry?.file)
    .filter(Boolean)
    .map((absolutePath) => path.relative(workspaceRoot, absolutePath));

  const steps = testFiles.length > 0
    ? [{ name: 'run-direct-tests', targets: testFiles }]
    : [];

  const relativeFilePath = path.relative(workspaceRoot, filePath).replace(/\\/g, '/');
  const commands = generateCommands(stack, changeType, [relativeFilePath], steps);

  // Deduplicate within each group by cmd string
  const dedupe = (arr) => {
    const seen = new Set();
    return (arr || []).filter((c) => {
      if (seen.has(c.cmd)) return false;
      seen.add(c.cmd);
      return true;
    });
  };

  commands.smoke = dedupe(commands.smoke);
  commands.focused = dedupe(commands.focused);
  commands.full = dedupe(commands.full);

  // Route B fix: when we have graph-derived direct affected tests, suppress
  // the coarser per-file focused-tests command that would pass the source
  // file itself to the test runner.
  if (steps.length > 0 && commands.focused.some((c) => c.name?.endsWith('-direct-tests'))) {
    commands.focused = commands.focused.filter((c) => !c.name?.endsWith('-focused-tests'));
  }

  // P8-2: enrich each command with structured executable metadata
  for (const group of ['smoke', 'focused', 'full']) {
    for (const cmd of commands[group]) {
      enrichCommandEntry(cmd);
    }
  }

  const fileSpecificAdvice = buildFileSpecificAdvice(ext, stack.profile);
  const allCommands = [
    ...(commands.focused || []),
    ...(commands.smoke || []),
    ...(commands.full || []),
  ];

  return {
    changeType,
    stack: {
      profile: stack.profile,
      js: stack.js,
      python: stack.python,
      java: stack.java,
      go: stack.go,
      rust: stack.rust,
    },
    commands,
    phases: [],
    suggestedCommand: pickSuggestedCommand(allCommands),
    fileSpecificAdvice,
  };
}

module.exports = { buildValidationAdvice, buildFileValidationAdvice };
