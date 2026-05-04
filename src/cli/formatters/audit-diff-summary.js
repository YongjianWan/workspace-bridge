const {
  scoreToLevel,
  diffSeverity,
  fileImpactSeverity,
} = require('../../config/risk-thresholds');
const { DEFAULTS } = require('../../config/constants');

const DOCS_EXTENSIONS = ['md', 'mdx', 'mdtxt', 'markdown', 'txt', 'rst'];
const CONFIG_EXTENSIONS = ['json', 'yaml', 'yml', 'toml', 'ini', 'conf', 'config'];

function buildAuditDiffSummary(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const mainlineChanged = list.filter((entry) => entry.classification?.isMainline);
  const affectedTests = new Set();
  let maxImpact = 0;
  let highRiskFiles = 0;
  let highHistoryRiskFiles = 0;
  let maxHistoryRiskScore = 0;
  let highCompositeRiskFiles = 0;
  let maxCompositeRiskScore = 0;
  const topCompositeRisks = [];

  for (const entry of list) {
    maxImpact = Math.max(maxImpact, entry.impactCount || 0);
    if (fileImpactSeverity(entry.impactCount || 0, entry.affectedTestCount || 0) === 'high') {
      highRiskFiles += 1;
    }
    const historyRiskScore = entry.historyRisk?.score || 0;
    maxHistoryRiskScore = Math.max(maxHistoryRiskScore, historyRiskScore);
    if (scoreToLevel(historyRiskScore) === 'high') {
      highHistoryRiskFiles += 1;
    }
    const compositeScore = entry.compositeRisk?.score || 0;
    maxCompositeRiskScore = Math.max(maxCompositeRiskScore, compositeScore);
    if (scoreToLevel(compositeScore) === 'high') {
      highCompositeRiskFiles += 1;
    }
    if (entry?.file && entry?.compositeRisk) {
      topCompositeRisks.push({
        file: entry.file,
        score: entry.compositeRisk.score,
        level: entry.compositeRisk.level,
        reason: entry.compositeRisk.reasons?.[0] || 'Composite risk signal',
      });
    }
    for (const testFile of entry.affectedTests || []) {
      affectedTests.add(testFile.file);
    }
  }

  const severity = diffSeverity({
    highRiskFileCount: highRiskFiles,
    affectedTestCount: affectedTests.size,
    highHistoryRiskFileCount: highHistoryRiskFiles,
    highCompositeRiskFileCount: highCompositeRiskFiles,
    mainlineChangedCount: mainlineChanged.length,
    maxImpact,
    maxHistoryRiskScore,
    maxCompositeRiskScore,
  });

  const nextSteps = [];
  if (mainlineChanged.length > 0) nextSteps.push('Review changed mainline files before merging.');
  if (affectedTests.size > 0) nextSteps.push('Run the directly affected tests first.');
  if (highHistoryRiskFiles > 0) nextSteps.push('Inspect high-history-risk files carefully; they changed often or recently.');
  if (highCompositeRiskFiles > 0) nextSteps.push('Prioritize high composite-risk files before broad validation.');
  if (entries.some((entry) => !entry.classification?.isMainline)) nextSteps.push('Verify whether non-mainline changes should be excluded from the audit.');
  if (nextSteps.length === 0) nextSteps.push('No changed files with structural impact were detected.');

  const impactExplanations = [];
  for (const entry of entries) {
    if (entry.impactExplanations?.length) {
      impactExplanations.push(...entry.impactExplanations);
    }
  }

  return {
    severity,
    counts: {
      changedFiles: entries.length,
      mainlineChangedFiles: mainlineChanged.length,
      affectedTests: affectedTests.size,
      maxImpact,
      highHistoryRiskFiles,
      maxHistoryRiskScore,
      highCompositeRiskFiles,
      maxCompositeRiskScore,
    },
    topCompositeRisks: topCompositeRisks
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, DEFAULTS.COMPACT_TOP_COMPOSITE_RISKS),
    impactExplanations: [...new Set(impactExplanations)].slice(0, DEFAULTS.COMPACT_EXPLANATIONS_MAX),
    nextSteps,
  };
}

function classifyChangeType(entries) {
  const types = new Set();
  let docsCount = 0;
  let codeCount = 0;
  let testCount = 0;
  let configCount = 0;
  let scriptCount = 0;

  for (const entry of entries) {
    const fileRole = entry.classification?.fileRole;
    const directoryRole = entry.classification?.directoryRole;
    const file = entry.file || '';
    const ext = file.split('.').pop()?.toLowerCase();

    // reference / archive 不参与主线变更类型判断
    if (directoryRole === 'reference' || directoryRole === 'archive') {
      continue;
    }

    // fileRole 是单一事实源；inferFileRole 已从路径/扩展名/文件名推断过一次。
    if (fileRole === 'docs') {
      types.add('docs');
      docsCount++;
    } else if (fileRole === 'config') {
      types.add('config');
      configCount++;
    } else if (fileRole === 'test') {
      types.add('tests');
      testCount++;
    } else if (fileRole === 'script') {
      types.add('scripts');
      scriptCount++;
    } else if (fileRole === 'entry' || fileRole === 'migration') {
      types.add('code');
      codeCount++;
    } else {
      // library / unknown / missing fileRole — 最小扩展名 fallback
      if (DOCS_EXTENSIONS.includes(ext)) {
        types.add('docs');
        docsCount++;
      } else if (CONFIG_EXTENSIONS.includes(ext)) {
        types.add('config');
        configCount++;
      } else {
        types.add('code');
        codeCount++;
      }
    }
  }

  const mainlineCount = docsCount + codeCount + testCount + configCount + scriptCount;
  if (mainlineCount === 0) {
    // All changes are in reference/archive/generated directories.
    // Return 'docs' (lightest validation template) rather than 'code',
    // since there are no mainline files to test.
    return 'docs';
  }

  const codeRatio = codeCount / mainlineCount;

  // docs 占严格多数且无 code/tests 时，优先返回 docs
  if (types.has('docs') && docsCount > mainlineCount - docsCount && !types.has('code') && !types.has('tests')) {
    return 'docs';
  }

  // 单一类型占绝对多数（>50%）时，直接返回该类型，避免被次要类型掩盖
  // docs  majority 已在上方严格多数检查中处理；此处不覆盖 tests/code 的存在
  const majorityThreshold = mainlineCount / 2;
  if (testCount > majorityThreshold) return 'tests';
  if (configCount > majorityThreshold) return 'config';
  if (scriptCount > majorityThreshold) return 'scripts';
  if (codeCount > majorityThreshold) return 'code';

  // code 占比超过阈值时，返回 code；否则按次要类型主导判断
  if (types.has('code') && codeRatio > DEFAULTS.CODE_CHANGE_RATIO_THRESHOLD) return 'code';
  if (types.has('tests')) return 'tests';
  if (types.has('config')) return 'config';
  if (types.has('scripts')) return 'scripts';
  if (types.has('docs')) return 'docs';
  if (types.has('code')) return 'code';
  return 'code';
}

function getValidationTemplate(changeType) {
  const templates = {
    docs: {
      smoke: {
        reason: 'Documentation changes: verify formatting and obvious errors first.',
        actions: [
          'Preview rendered markdown for formatting issues.',
          'Check for broken internal links.',
          'Verify code examples in docs still match current API.',
        ],
      },
      focused: {
        reason: 'Review content accuracy and completeness.',
        actions: [
          'Review changed sections for technical accuracy.',
          'Check if related docs need同步更新.',
        ],
      },
      full: {
        reason: 'Final polish before merge.',
        actions: [
          'Run docs linting if available (markdownlint, etc.).',
          'Verify external links are not broken.',
        ],
      },
    },
    config: {
      smoke: {
        reason: 'Config changes: validate syntax and basic structure first.',
        actions: [
          'Validate JSON/YAML syntax.',
          'Check config schema if available.',
          'Verify required fields are present.',
        ],
      },
      focused: {
        reason: 'Test config consumption points.',
        actions: [
          'Run affected unit tests that read this config.',
          'Start the app/service to verify config loads correctly.',
          'Check for environment-specific values that might break.',
        ],
      },
      full: {
        reason: 'Full integration verification.',
        actions: [
          'Run full test suite to catch subtle config side effects.',
          'Verify in staging environment if applicable.',
        ],
      },
    },
    tests: {
      smoke: {
        reason: 'Test changes: verify tests run and pass first.',
        actions: [
          'Run the modified tests to ensure they pass.',
          'Check for syntax errors in new test code.',
        ],
      },
      focused: {
        reason: 'Validate test quality and coverage.',
        actions: [
          'Review test assertions for correctness.',
          'Check that tests actually test what they claim.',
          'Verify test setup/teardown is proper.',
        ],
      },
      full: {
        reason: 'Ensure no regressions in related areas.',
        actions: [
          'Run full test suite to catch side effects.',
          'Check test runtime - no significant slowdowns.',
        ],
      },
    },
    scripts: {
      smoke: {
        reason: 'Script changes: check syntax and basic execution.',
        actions: [
          'Run script with --help or dry-run if supported.',
          'Check for syntax errors (shellcheck for bash, etc.).',
          'Verify script is executable (chmod +x).',
        ],
      },
      focused: {
        reason: 'Test script in isolated context.',
        actions: [
          'Run script against test data or staging environment.',
          'Verify error handling works correctly.',
          'Check script output format.',
        ],
      },
      full: {
        reason: 'Integration and edge case testing.',
        actions: [
          'Test script with various input combinations.',
          'Verify cleanup on interruption/failure.',
          'Check logging and observability.',
        ],
      },
    },
    code: {
      smoke: {
        reason: 'Always start with a cheap sanity pass over the edited surface.',
        actions: [
          'Open the changed files and sanity-check obvious regressions.',
          'Run the lightest command that proves the CLI still starts and basic commands still return JSON.',
        ],
      },
      focused: {
        reason: 'These files or tests are closest to the current change and most likely to catch breakage fast.',
        actions: [
          'Run directly affected tests first.',
          'Inspect history-risk and high-impact files carefully.',
        ],
      },
      full: {
        reason: 'Broaden validation once the cheap and focused checks are clean.',
        actions: [
          'Run indirectly affected tests next.',
          'Re-check graph-touched modules before merge.',
        ],
      },
    },
  };

  return templates[changeType] || templates.code;
}

/**
 * Compact a single changed-file entry for AI consumption.
 * Keeps counts, compositeRisk, and a capped slice of impact/affectedTests.
 * Drops heavy details (symbolImpact, changedLineRanges, recentCommits, resolvedPath).
 */
function compactChangedFile(entry) {
  if (!entry || typeof entry !== 'object') return entry;

  const impact = Array.isArray(entry.impact) ? entry.impact : [];
  const affectedTests = Array.isArray(entry.affectedTests) ? entry.affectedTests : [];
  const impactExplanations = Array.isArray(entry.impactExplanations) ? entry.impactExplanations : [];

  const historyRisk = entry.historyRisk
    ? { score: entry.historyRisk.score, level: entry.historyRisk.level }
    : null;

  return {
    file: entry.file,
    classification: entry.classification,
    graphKnown: entry.graphKnown,
    impactCount: entry.impactCount || 0,
    impact: impact.slice(0, DEFAULTS.COMPACT_IMPACT_MAX),
    affectedTestCount: entry.affectedTestCount || 0,
    affectedTests: affectedTests.slice(0, DEFAULTS.COMPACT_AFFECTED_TESTS_MAX),
    compositeRisk: entry.compositeRisk || null,
    historyRisk,
    impactExplanations: impactExplanations.slice(0, DEFAULTS.COMPACT_EXPLANATIONS_MAX),
  };
}

module.exports = {
  buildAuditDiffSummary,
  classifyChangeType,
  getValidationTemplate,
  compactChangedFile,
};
