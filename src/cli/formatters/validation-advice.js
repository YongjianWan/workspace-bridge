const path = require('path');
const { detectStack, generateCommands } = require('../../utils/stack-detector');
const { classifyChangeType, getValidationTemplate } = require('./audit-diff-summary');
const { collectEntryMetrics } = require('./validation-advice/metrics');
const { buildPhases } = require('./validation-advice/phases');
const { buildSummary } = require('./validation-advice/summary');
const { buildTopRiskActions } = require('./validation-advice/risk-actions');

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
    advice.push('检查模板绑定和组件 props 变更是否同步更新。');
  } else if (ext === '.java' && stackProfile === 'java-first') {
    advice.push('检查接口契约变更和下游 Controller/Service 调用方兼容性。');
  } else if (ext === '.py' && stackProfile === 'python-first') {
    advice.push('检查模型字段变更是否需配套迁移脚本。');
  } else if (ext === '.go' && stackProfile === 'go-first') {
    advice.push('检查接口变更是否破坏已有实现方（interface compliance）。');
  } else if (ext === '.rs' && stackProfile === 'rust-first') {
    advice.push('检查 trait 实现变更是否影响下游依赖（trait bound compliance）。');
  }
  return advice;
}

function buildFileValidationAdvice(filePath, workspaceRoot) {
  const stack = detectStack(workspaceRoot);
  const ext = path.extname(filePath).toLowerCase();

  // Infer change type from extension for single-file context
  let changeType = 'code';
  if (/\.(md|rst|txt)$/.test(ext)) changeType = 'docs';
  else if (/\.(json|yaml|yml|toml)$/.test(ext)) changeType = 'config';
  else if (/\.(sh|ps1|bat)$/.test(ext)) changeType = 'scripts';

  const commands = generateCommands(stack, changeType, [filePath]);

  // Flatten to a single list for AI consumption
  const allCommands = [
    ...(commands.focused || []),
    ...(commands.smoke || []),
    ...(commands.full || []),
  ];

  // Deduplicate by cmd string
  const seen = new Set();
  const uniqueCommands = allCommands.filter((c) => {
    if (seen.has(c.cmd)) return false;
    seen.add(c.cmd);
    return true;
  });

  const fileSpecificAdvice = buildFileSpecificAdvice(ext, stack.profile);

  return {
    changeType,
    stackProfile: stack.profile,
    commandCount: uniqueCommands.length,
    commands: uniqueCommands,
    fileSpecificAdvice,
  };
}

module.exports = { buildValidationAdvice, buildFileValidationAdvice };
