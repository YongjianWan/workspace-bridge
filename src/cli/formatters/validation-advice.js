const path = require('path');
const { detectStack, generateCommands, enrichCommandEntry, INFRA_PATTERNS } = require('../../utils/stack-detector');
const { probePythonTestEnvironment } = require('../../utils/environment-probe');
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

  const commands = generateCommands(stack, changeType, smokeTargets, focusedSteps, workspaceRoot);
  const environmentNotes = workspaceRoot ? probePythonTestEnvironment(workspaceRoot, stack.python) : [];

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
    environmentNotes,
  };
}

/**
 * Lightweight validation advice for a single file (audit-file).
 * Detects stack and returns focused commands without full phase orchestration.
 */
/**
 * Build file-specific advice with context awareness.
 *
 * Route B fix: suppresses irrelevant advice when the file has 0 downstream
 * impact (e.g., a dead file being deleted doesn't need migration warnings).
 *
 * @param {string} ext - file extension
 * @param {string} stackProfile - detected stack profile
 * @param {object} [context] - optional impact context
 * @param {number} [context.impactCount] - number of impacted dependents
 * @param {number} [context.affectedTestsCount] - number of affected tests
 * @param {boolean} [context.isDeadExport] - whether this file has no importers
 */
function buildFileSpecificAdvice(ext, stackProfile, context = {}) {
  const { impactCount = 1, affectedTestsCount = 0, isDeadExport = false } = context;
  const advice = [];

  // Route B: when the file has zero downstream impact (dead code removal),
  // suppress model/migration/interface advice — it's irrelevant noise.
  const hasNoImpact = impactCount === 0 && affectedTestsCount === 0;

  if (ext === '.vue' && stackProfile === 'node-first' && !hasNoImpact) {
    advice.push('Verify template bindings and component prop changes are synchronized.');
  } else if (ext === '.java' && stackProfile === 'java-first' && !hasNoImpact) {
    advice.push('Check interface contract changes and downstream Controller/Service caller compatibility.');
  } else if (ext === '.py' && stackProfile === 'python-first') {
    if (isDeadExport && hasNoImpact) {
      advice.push('This file has no downstream dependents and no affected tests. Safe to delete or archive.');
    } else if (!hasNoImpact) {
      advice.push('Check if model field changes require a companion migration script.');
    }
  } else if (ext === '.go' && stackProfile === 'go-first' && !hasNoImpact) {
    advice.push('Verify interface changes do not break existing implementers (interface compliance).');
  } else if (ext === '.rs' && stackProfile === 'rust-first' && !hasNoImpact) {
    advice.push('Check trait implementation changes affect downstream dependencies (trait bound compliance).');
  }
  return advice;
}

function buildFileValidationAdvice(filePath, workspaceRoot, affectedTests, impact) {
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

  const hasDirectAffectedTests = testFiles.length > 0;
  const steps = hasDirectAffectedTests
    ? [{ name: 'run-direct-tests', targets: testFiles }]
    : [];

  // Route B: when there are no affected tests, omit focused test commands
  // entirely so suggestedCommand doesn't point to a non-existent test file.
  // 例外：编译型语言（Java/Kotlin/Go/Rust/C++）的 compile-check fallback 依赖
  // targets 里出现该语言文件才会生成，且这些命令不引用源文件路径本身，
  // 不存在“指向不存在的测试文件”问题——必须始终传入变更文件。
  // infra 文件（Dockerfile/CI/.env）同理：mixed repo 的 mixed-infra-smoke 提醒
  // 依赖 targets 里出现该文件，且提醒不引用测试路径——必须传入。
  const relativeFilePath = path.relative(workspaceRoot, filePath).replace(/\\/g, '/');
  const isCompiledLanguageFile = /\.(java|kt|kts|go|rs|c|cc|cpp|h|hpp)$/i.test(relativeFilePath);
  const isInfraFile = INFRA_PATTERNS.test(relativeFilePath);
  const changedTargets = (hasDirectAffectedTests || isCompiledLanguageFile || isInfraFile) ? [relativeFilePath] : [];
  const commands = generateCommands(stack, changeType, changedTargets, steps, workspaceRoot);
  const environmentNotes = probePythonTestEnvironment(workspaceRoot, stack.python);

  // Deduplicate within each group by cmd string. Advisory entries
  // (executable: null) have no cmd — fall back to name so two distinct
  // advisories don't collide on undefined.
  const dedupe = (arr) => {
    const seen = new Set();
    return (arr || []).filter((c) => {
      const key = c.cmd || c.name;
      if (seen.has(key)) return false;
      seen.add(key);
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

  // Route B: pass impact context so fileSpecificAdvice can suppress irrelevant advice
  // impactCount comes from the `impact` parameter, not affectedTests (which is a different operation).
  const impactCount = impact?.impactCount ?? affectedTests?.impactCount ?? 1;
  const affectedTestsCount = affectedTests?.affectedTestsCount ?? 0;
  const impactContext = {
    impactCount,
    affectedTestsCount,
    isDeadExport: impactCount === 0 && affectedTestsCount === 0,
  };
  const fileSpecificAdvice = buildFileSpecificAdvice(ext, stack.profile, impactContext);
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
    environmentNotes,
  };
}

module.exports = { buildValidationAdvice, buildFileValidationAdvice };
