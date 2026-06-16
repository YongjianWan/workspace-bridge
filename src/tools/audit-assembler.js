/**
 * audit-assembler.js - L4 Curation Facade Layer
 * Down-shifts all result curation, filtering, baseline checking,
 * and aggregation logic from the CLI command handlers.
 */
const fs = require('fs');
const path = require('path');
const { dependencyGraph } = require('./dep-tools');
const { findWorkspaceRoot, detectWorkspace, pathExists } = require('../utils/path');
const { detectNodePackageManager, detectTestRunner, detectStack } = require('../utils/stack-detector');
const { checkParserAvailability } = require('../utils/environment-probe');
const {
  buildRepoSummary,
  buildAuditDiffSummary,
  buildValidationAdvice,
  buildImpactExplanations,
  compactChangedFile,
  buildFileSummary,
  buildFileValidationAdvice
} = require('../cli/formatters');
const { getChangedFiles, getChangedLineRanges, getFileHistoryRisk, getDiffNumstat } = require('./git-tools');
const { getFileComplexityTrend } = require('./complexity-tools');
const { resolveWorkspaceFilePath } = require('../utils/path');
const { mapWithConcurrency } = require('../utils/async');
const { DATA_QUALITY } = require('../config/data-quality');
const { DEFAULTS } = require('../config/constants');
const { truncateArray } = require('../utils/truncate');
const { auditSecurity, groupBySeverity } = require('./security-tools');
const { buildCompositeRisk } = require('../cli/formatters');
const { filterByCategory, parseCategories } = require('./category-filter');

const SEVERITY_RANK = { high: 3, medium: 2, low: 1 };

function severityMeetsFilter(itemSeverity, minSeverity) {
  if (!minSeverity || !SEVERITY_RANK[minSeverity]) return true;
  return (SEVERITY_RANK[itemSeverity] || 0) >= SEVERITY_RANK[minSeverity];
}

function resolveCompact(parsed, container, changedFileCount = 0) {
  if (parsed.noCompact) return { compact: false, autoCompact: false };
  if (parsed.compact) return { compact: true, autoCompact: false };
  const totalFiles = container?.snapshot?.graph?.getStats?.()?.files ?? 0;
  if (totalFiles > DEFAULTS.LARGE_PROJECT_FILE_THRESHOLD) {
    return { compact: true, autoCompact: true };
  }
  return { compact: false, autoCompact: false };
}

async function assembleSummary(parsed, container) {
  const regressionTools = require('./regression-tools');

  const [health, deadExports, unresolved, cycles] = await Promise.all([
    projectHealth({ cwd: parsed.cwd }, container),
    dependencyGraph({ cwd: parsed.cwd, operation: 'dead_exports' }, container),
    dependencyGraph({ cwd: parsed.cwd, operation: 'unresolved' }, container),
    dependencyGraph({ cwd: parsed.cwd, operation: 'cycles' }, container),
  ]);

  if (parsed.severity && deadExports.ok && deadExports.deadExports) {
    const filtered = deadExports.deadExports.filter((d) => severityMeetsFilter(d.confidence, parsed.severity));
    deadExports.deadExports = filtered;
    deadExports.deadExportsCount = filtered.length;
    if (deadExports.possibleFalsePositives) {
      deadExports.possibleFalsePositives.count = filtered.length;
      deadExports.possibleFalsePositives.total = filtered.length;
      if (filtered.length === 0) {
        deadExports.possibleFalsePositives.primaryReason = 'unknown';
        deadExports.possibleFalsePositives.reasons = [];
        deadExports.possibleFalsePositives.disclaimer = null;
      }
    }
  }

  // 15-1 AST Rules Engine integration
  const { checkAllRules } = require('../services/dep-graph/ast-rules');
  let astRulesRaw = [];
  if (container.snapshot && container.snapshot.graph) {
    astRulesRaw = checkAllRules(container.snapshot.graph.graph);
  }

  if (parsed.severity) {
    astRulesRaw = astRulesRaw.filter((f) => severityMeetsFilter(f.severity, parsed.severity));
  }

  const ignoreFindings = container.projectContext?.config?.ignore?.findings;
  if (ignoreFindings?.length > 0) {
    const ignoredSet = new Set(ignoreFindings);
    astRulesRaw = astRulesRaw.filter((f) => !ignoredSet.has(f.id));
  }

  const astRules = {
    ok: true,
    findingsCount: astRulesRaw.length,
    findings: astRulesRaw,
  };

  const sections = { health, deadExports, unresolved, cycles, astRules };
  filterByCategory(sections, parsed.category, ['health', 'deadExports', 'unresolved', 'cycles', 'astRules']);

  const scope = container.snapshot.graph.getScopeSummary();
  const { detectStack } = require('../utils/stack-detectors/detect');
  const stack = detectStack(container.workspaceRoot);
  const stats = container.snapshot.graph.getStats();
  const filteredAnalysisCoverage = stats.filteredAnalysisCoverage || stats.analysisCoverage || null;

  const result = {
    ok: [sections.health, sections.deadExports, sections.unresolved, sections.cycles, sections.astRules].every((r) => r.ok !== false),
    workspaceRoot: container.workspaceRoot,
    scope,
    summary: buildRepoSummary(sections.health, sections.deadExports, sections.unresolved, sections.cycles, scope, stack.profile, filteredAnalysisCoverage, stack),
    health: sections.health,
    deadExports: sections.deadExports,
    unresolved: sections.unresolved,
    cycles: sections.cycles,
    astRules: sections.astRules,
  };

  regressionTools.applyBaselineOperations(result, parsed);

  // Calculate hasFindings O(1) return contract
  result.hasFindings =
    (result.deadExports?.deadExportsCount || 0) > 0 ||
    (result.unresolved?.unresolvedCount || 0) > 0 ||
    (result.cycles?.cyclesCount || 0) > 0 ||
    (result.astRules?.findingsCount || 0) > 0 ||
    (result.health?.healthScoreNumeric?.ratio || 1) < 1;

  return result;
}

function buildChangeMetrics(numstat, changed) {
  if (!numstat.ok) return null;
  return {
    totalAdditions: numstat.totalAdditions,
    totalDeletions: numstat.totalDeletions,
    changedFileCount: numstat.files.length,
    untrackedFileCount: Math.max(0, changed.changedFiles.length - numstat.files.length),
  };
}

async function buildDiffEntry(relativeFile, container, parsed) {
  const { since, commits, staged, reuseHints: reuseHintsFlag, quiet, maxDepth } = parsed;
  const resolvedPath = resolveWorkspaceFilePath(relativeFile, container.workspaceRoot);
  const classification = container.projectContext?.classifyFile(resolvedPath) || null;
  const graphKnown = Boolean(resolvedPath && container.snapshot.graph.hasFile(resolvedPath));
  const impact = graphKnown ? container.snapshot.graph.getImpactRadius(resolvedPath) : [];
  let changedLineRanges = [];
  if (resolvedPath) {
    if (commits) {
      const rangeResult = await getChangedLineRanges(container.workspaceRoot, resolvedPath, { commits }).catch(() => ({ ok: false }));
      if (rangeResult.ok) changedLineRanges = rangeResult.lineRanges;
    } else if (since) {
      const rangeResult = await getChangedLineRanges(container.workspaceRoot, resolvedPath, { since }).catch(() => ({ ok: false }));
      if (rangeResult.ok) changedLineRanges = rangeResult.lineRanges;
    } else if (staged) {
      const stagedResult = await getChangedLineRanges(container.workspaceRoot, resolvedPath, { staged: true }).catch(() => ({ ok: false }));
      if (stagedResult.ok) changedLineRanges = stagedResult.lineRanges;
    } else {
      const [unstagedResult, stagedResult] = await Promise.all([
        getChangedLineRanges(container.workspaceRoot, resolvedPath, { staged: false }).catch(() => ({ ok: false })),
        getChangedLineRanges(container.workspaceRoot, resolvedPath, { staged: true }).catch(() => ({ ok: false })),
      ]);
      const ranges = [];
      if (unstagedResult.ok) ranges.push(...unstagedResult.lineRanges);
      if (stagedResult.ok) ranges.push(...stagedResult.lineRanges);
      const seen = new Set();
      changedLineRanges = ranges.filter((r) => {
        const key = `${r.startLine}-${r.endLine}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).sort((a, b) => a.startLine - b.startLine);
    }
  }
  const baseSymbolImpact = graphKnown ? container.snapshot.graph.getSymbolImpact(resolvedPath) : null;
  const changedFunctionImpactBase = graphKnown
    ? container.snapshot.graph.getChangedFunctionImpact(resolvedPath, changedLineRanges, { symbolImpact: baseSymbolImpact })
    : null;
  let reuseHints = [];
  if (reuseHintsFlag === 'on' && graphKnown && changedFunctionImpactBase?.mode === 'function-symbol') {
    try {
      reuseHints = container.snapshot.graph.getFunctionReuseHints(resolvedPath, changedFunctionImpactBase.changedFunctions, {
        minScore: DEFAULTS.REUSE_HINTS_MIN_SCORE,
        maxPerFunction: DEFAULTS.REUSE_HINTS_MAX_PER_FUNCTION,
      });
    } catch (e) {
      if (!quiet) {
        console.error(`[warn] reuse hints failed for ${relativeFile}: ${e?.message || String(e)}`);
      }
      reuseHints = [];
    }
  }
  const functionLevelAffectedTests = graphKnown &&
    (changedFunctionImpactBase?.mode === 'function-symbol' || changedFunctionImpactBase?.mode === 'internal-function-call-chain')
    ? container.snapshot.graph.getFunctionLevelAffectedTests(
      resolvedPath,
      changedFunctionImpactBase.changedFunctions,
      {
        symbolImpact: baseSymbolImpact,
        maxDepth: maxDepth ?? DEFAULTS.SYMBOL_IMPACT_DEPTH,
      }
    )
    : { functions: [], affectedTestsCount: 0 };
  const changedFunctionImpact = changedFunctionImpactBase
    ? { ...changedFunctionImpactBase, reuseHints, functionLevelAffectedTests }
    : null;
  const symbolImpact = baseSymbolImpact
    ? { ...baseSymbolImpact, changedFunctionImpact }
    : null;
  const affectedTestsRaw = graphKnown ? container.snapshot.graph.findAffectedTests(resolvedPath, maxDepth) : [];
  const affectedTestsTrunc = truncateArray(affectedTestsRaw, DEFAULTS.JSON_OUTPUT_MAX_AFFECTED_TESTS_ITEMS);
  const affectedTests = affectedTestsTrunc.items;

  const affectedRoutesRaw = graphKnown ? container.snapshot.graph.findAffectedRoutes(resolvedPath) : [];
  const affectedRoutesTrunc = truncateArray(affectedRoutesRaw, DEFAULTS.JSON_OUTPUT_MAX_AFFECTED_ROUTES_ITEMS);
  const affectedRoutes = affectedRoutesTrunc.items;

  const history = resolvedPath ? await getFileHistoryRisk(container.workspaceRoot, resolvedPath, { limit: DEFAULTS.HISTORY_LIMIT }) : { ok: false };
  const historyRisk = history.ok ? history.historyRisk : null;
  const impactExplanations = graphKnown
    ? buildImpactExplanations({ file: relativeFile, impact })
    : [];
  const frameworkPattern = container.snapshot.graph.getFrameworkHint(resolvedPath);
  const complexityTrend = resolvedPath
    ? await getFileComplexityTrend(container.workspaceRoot, resolvedPath, { since, commits, staged }).catch(() => 'STABLE')
    : 'STABLE';
  const baseEntry = {
    file: relativeFile,
    resolvedPath,
    classification,
    graphKnown,
    frameworkPattern,
    impactCount: impact.length,
    impact,
    changedLineRanges,
    symbolImpact,
    affectedTestsCount: affectedTestsRaw.length,
    affectedTests,
    affectedRoutes,
    historyRisk,
    recentCommits: history.ok ? history.recentCommits : [],
    impactExplanations,
    complexityTrend,
    truncated: affectedTestsTrunc.truncated || affectedRoutesTrunc.truncated,
  };
  const compositeRisk = buildCompositeRisk(baseEntry);

  return {
    ...baseEntry,
    compositeRisk,
  };
}

function buildDiffResult(safeEntries, finalEntries, changeMetrics, parsed, container) {
  const { detectStack } = require('../utils/stack-detectors/detect');
  const stack = detectStack(container.workspaceRoot);
  const env = container.gitEnvironment || { dataQuality: DATA_QUALITY.CERTAIN, remediation: null };

  const result = {
    ok: true,
    workspaceRoot: container.workspaceRoot,
    scope: container.snapshot.graph.getScopeSummary(),
    summary: buildAuditDiffSummary(finalEntries, changeMetrics, stack.profile),
    validationAdvice: buildValidationAdvice(finalEntries, container.workspaceRoot),
    options: {
      reuseHints: parsed.reuseHints,
      reuseHintsApplied: finalEntries.reduce((sum, e) => sum + (e.changedFunctionImpact?.reuseHints?.length || 0), 0),
    },
    changedFiles: finalEntries,
    dataQuality: env.dataQuality,
    ...(env.remediation ? { environmentRemediation: env.remediation } : {}),
  };
  if (parsed.incremental) {
    const { buildIncrementalFindings } = require('./incremental-diff');
    const changedPaths = safeEntries.map((e) => e.resolvedPath).filter(Boolean);
    result.incremental = true;
    result.incrementalFindings = buildIncrementalFindings(changedPaths, container, parsed);
  }
  if (parsed.withImpact) {
    const impactFiles = new Set();
    for (const entry of safeEntries) {
      if (!entry.resolvedPath) continue;
      try {
        const impact = container.snapshot.graph.getImpactRadius(entry.resolvedPath, 2);
        for (const i of impact) {
          if (i.file && i.file !== entry.resolvedPath) {
            impactFiles.add(i.file);
          }
        }
      } catch (err) {
        if (process.env.DEBUG) {
          console.error(`[CLI] Impact calculation failed for ${entry.resolvedPath}:`, err.message);
        }
      }
    }
    result.impactFiles = Array.from(impactFiles);
  }

  // Calculate hasFindings O(1) return contract
  result.hasFindings = result.summary?.counts?.highCompositeRiskFiles > 0 || result.summary?.counts?.affectedTests > 0;

  return result;
}

async function assembleDiff(parsed, container) {
  const since = parsed.since || null;
  const commits = parsed.commits || null;
  const staged = parsed.staged === true;
  const explicitFiles = parsed.files ? parsed.files.split(',').map((f) => f.trim()).filter(Boolean) : null;

  let changed;
  if (explicitFiles) {
    changed = { ok: true, workspaceRoot: container.workspaceRoot, changedFiles: explicitFiles };
  } else {
    changed = await getChangedFiles(container.workspaceRoot, { staged, includeUntracked: !staged, since, commits });
    if (changed.ok === false) {
      return changed;
    }
  }

  const numstat = explicitFiles
    ? { ok: false }
    : await getDiffNumstat(container.workspaceRoot, { staged, includeUntracked: !staged, since, commits });

  // Honor --max-files: process only the first N changed files.
  let changedFiles = changed.changedFiles;
  let totalChangedFiles = changedFiles.length;
  let maxFilesTruncated = false;
  if (parsed.maxFiles && changedFiles.length > parsed.maxFiles) {
    changedFiles = changedFiles.slice(0, parsed.maxFiles);
    maxFilesTruncated = true;
  }

  // Recompute changeMetrics for the truncated subset so summary numbers match
  // the actually analyzed files. Untracked files are not in numstat; keep the
  // difference as the untracked count.
  let changeMetrics = buildChangeMetrics(numstat, { changedFiles });
  if (maxFilesTruncated && numstat.ok && changeMetrics) {
    const truncatedSet = new Set(changedFiles);
    const filtered = numstat.files.filter((f) => truncatedSet.has(f.file));
    changeMetrics = {
      totalAdditions: filtered.reduce((sum, f) => sum + f.added, 0),
      totalDeletions: filtered.reduce((sum, f) => sum + f.removed, 0),
      changedFileCount: filtered.length,
      untrackedFileCount: Math.max(0, changedFiles.length - filtered.length),
    };
  }

  const entries = await mapWithConcurrency(changedFiles, DEFAULTS.CLI_CONCURRENCY, (relativeFile) =>
    buildDiffEntry(relativeFile, container, parsed)
  );
  let safeEntries = entries.map((entry, index) => {
    if (!entry?.__error) return entry;
    const baseEntry = {
      file: changedFiles[index],
      resolvedPath: null,
      classification: null,
      graphKnown: false,
      frameworkPattern: null,
      impactCount: 0,
      impact: [],
      changedLineRanges: [],
      symbolImpact: null,
      affectedTestsCount: 0,
      affectedTests: [],
      historyRisk: null,
      recentCommits: [],
      processingError: entry.__error,
    };
    return {
      ...baseEntry,
      compositeRisk: buildCompositeRisk(baseEntry),
    };
  });

  const { compact, autoCompact } = resolveCompact(parsed, container);
  const finalEntries = compact
    ? safeEntries.map((entry) => compactChangedFile(entry))
    : safeEntries;

  const result = buildDiffResult(safeEntries, finalEntries, changeMetrics, parsed, container);
  result.options.compact = compact;
  result.options.autoCompact = autoCompact;
  if (parsed.maxFiles) {
    result.options.maxFiles = parsed.maxFiles;
    result.options.totalChangedFiles = totalChangedFiles;
    result.options.maxFilesTruncated = maxFilesTruncated;
    result.truncated = maxFilesTruncated;
  }
  return result;
}

async function assembleFile(parsed, container) {
  const resolvedPath = resolveWorkspaceFilePath(parsed.file, container.workspaceRoot);
  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    return { ok: false, error: `File not found: ${parsed.file}`, inProject: false, hasFindings: false };
  }
  // Honor --depth parameter (surface | detail | full)
  const maxDepth = parsed.depth === 'surface' ? 1 : parsed.depth === 'detail' ? DEFAULTS.SYMBOL_IMPACT_DEPTH : undefined;
  const actualMaxDepth = parsed.maxDepth ?? maxDepth;

  const [impact, affectedTests] = await Promise.all([
    dependencyGraph({ cwd: parsed.cwd, operation: 'impact', file: parsed.file }, container),
    dependencyGraph({
      cwd: parsed.cwd,
      operation: 'affected_tests',
      file: parsed.file,
      maxDepth: actualMaxDepth,
    }, container),
  ]);
  const frameworkPattern = container.snapshot.graph.getFrameworkHint(resolvedPath);
  const validationAdvice = buildFileValidationAdvice(resolvedPath, container.workspaceRoot);
  const result = {
    ok: impact.ok !== false && affectedTests.ok !== false,
    workspaceRoot: container.workspaceRoot,
    file: parsed._rawFile || parsed.file,
    resolvedPath: impact.resolvedPath || affectedTests.resolvedPath || null,
    summary: buildFileSummary(impact, affectedTests),
    frameworkPattern,
    validationAdvice,
    impact,
    affectedTests,
  };

  // Calculate hasFindings O(1) return contract
  result.hasFindings = (result.impact?.impactCount || 0) > 0 || (result.affectedTests?.affectedTestsCount || 0) > 0;

  return result;
}

async function assembleSecurity(parsed, container) {
  const explicitSecFiles = parsed.files ? parsed.files.split(',').map((f) => f.trim()).filter(Boolean) : null;
  const secResult = await auditSecurity({
    cwd: parsed.cwd,
    targets: explicitSecFiles || parsed.targets,
    config: parsed.config,
    language: parsed.language,
    builtinOnly: parsed.builtinOnly,
  }, container);

  if (parsed.severity && secResult.findings) {
    secResult.findings = secResult.findings.filter((f) => severityMeetsFilter(f.severity, parsed.severity));
    secResult.summary.total = secResult.findings.length;
    secResult.summary.bySeverity = groupBySeverity(secResult.findings);
  }

  // Wave 12-3: --category filter support for audit-security.
  if (parsed.category) {
    const categories = parseCategories(parsed.category);
    if (categories && !categories.includes('security')) {
      secResult.findings = [];
      secResult.summary = { ...secResult.summary, total: 0, bySeverity: groupBySeverity([]) };
      secResult.scanMeta = secResult.scanMeta?.map((m) => ({ ...m, summary: { ...m.summary, total: 0 } })) || [];
    }
  }

  // Calculate hasFindings O(1) return contract
  secResult.hasFindings = (secResult.summary?.total || 0) > 0;

  return secResult;
}

function checkHealthFile(root, candidates) {
  for (const name of candidates) {
    const filePath = path.join(root, name);
    if (pathExists(filePath)) {
      try {
        const stat = require('fs').statSync(filePath);
        return { found: true, file: name, sizeBytes: stat.size };
      } catch (e) {
        return { found: true, file: name };
      }
    }
  }
  return { found: false, candidates };
}

function hasWorkflowFiles(dir) {
  try {
    const files = require('fs').readdirSync(dir);
    return files.some((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
  } catch {
    return false;
  }
}

function detectCiConfig(root) {
  const ciConfigs = [
    { name: 'GitHub Actions', path: '.github/workflows', check: (p) => hasWorkflowFiles(p) },
    { name: 'GitLab CI', path: '.gitlab-ci.yml' },
    { name: 'CircleCI', path: '.circleci/config.yml' },
    { name: 'Travis CI', path: '.travis.yml' },
    { name: 'Jenkins', path: 'Jenkinsfile' },
    { name: 'Azure Pipelines', path: 'azure-pipelines.yml' },
    { name: 'Bitbucket Pipelines', path: 'bitbucket-pipelines.yml' },
  ];

  const found = [];
  for (const ci of ciConfigs) {
    const fullPath = path.join(root, ci.path);
    const detected = ci.check ? ci.check(fullPath) : pathExists(fullPath);
    if (detected) {
      found.push({ name: ci.name, path: ci.path });
    }
  }
  return { found: found.length > 0, configs: found };
}

function detectTestConfig(root) {
  const frameworks = [];
  const runner = detectTestRunner(root);
  if (runner?.type === 'node') {
    frameworks.push(runner.name === 'custom' ? 'custom-node-scripts' : runner.name);
  }
  if (runner?.type === 'python') {
    frameworks.push(runner.name);
  }
  if (frameworks.length === 0 && pathExists(path.join(root, 'manage.py'))) {
    frameworks.push('django-test');
  }
  return { found: frameworks.length > 0, frameworks };
}

function buildFixSuggestions(stack) {
  const profile = stack?.profile || 'unknown';
  const isNode = stack?.node?.enabled;
  const isJava = stack?.java?.enabled;
  const isPython = stack?.python?.enabled;
  const isGo = stack?.go?.enabled;
  const isRust = stack?.rust?.enabled;
  const isCpp = stack?.cpp?.enabled;

  let testAction = 'Set up a test runner (e.g., Jest, pytest, cargo test)';
  if (isJava) {
    testAction = 'Set up Java tests (e.g., mvn test, gradle test)';
  } else if (isPython) {
    testAction = 'Set up a Python test runner (e.g., pytest)';
  } else if (isGo) {
    testAction = 'Go testing is built-in with go test; ensure module structure supports your test files';
  } else if (isRust) {
    testAction = 'Rust testing is built-in with cargo test; ensure workspace members are configured';
  } else if (isCpp) {
    testAction = 'Set up a C++ test runner (e.g., CTest, Google Test)';
  } else if (isNode || profile === 'mixed') {
    const runner = stack?.node?.testRunner;
    if (runner && runner !== 'custom') {
      testAction = `Complete ${runner} setup (runner detected but test script or config may be missing)`;
    } else {
      testAction = 'Set up a test runner (e.g., Vitest for Vite projects, Jest for plain Node)';
    }
  }

  return {
    readme: { action: 'Create README.md with project description and usage instructions', severity: 'medium' },
    license: { action: 'Add a LICENSE file (e.g., MIT, Apache-2.0)', severity: 'low' },
    gitignore: { action: 'Create .gitignore to exclude build artifacts and dependencies', severity: 'high' },
    editorconfig: { action: 'Add .editorconfig for consistent coding style across editors', severity: 'low' },
    envExample: { action: 'Create .env.example documenting required environment variables', severity: 'medium' },
    dockerConfig: { action: 'Add Dockerfile or docker-compose.yml for containerized deployment', severity: 'low' },
    ci: { action: 'Add CI configuration (e.g., .github/workflows/ci.yml)', severity: 'medium' },
    testConfig: { action: testAction, severity: 'high' },
  };
}

function projectHealth(args, container) {
  const target = args?.cwd || process.cwd();
  const root = container?.workspaceRoot || findWorkspaceRoot(target);
  const workspace = detectWorkspace(root);

  const checks = {
    readme: checkHealthFile(root, ['README.md', 'README.rst', 'README.txt', 'readme.md']),
    license: checkHealthFile(root, ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'COPYING']),
    gitignore: checkHealthFile(root, ['.gitignore']),
    editorconfig: checkHealthFile(root, ['.editorconfig']),
    envExample: checkHealthFile(root, ['.env.example', '.env.sample', '.env.template', '.env.development', '.env.production']),
    dockerConfig: checkHealthFile(root, ['Dockerfile', 'docker-compose.yml', 'docker-compose.yaml']),
    ci: detectCiConfig(root),
    testConfig: detectTestConfig(root),
  };

  for (const key of Object.keys(checks)) {
    if (checks[key] && typeof checks[key] === 'object' && 'sizeBytes' in checks[key]) {
      delete checks[key].sizeBytes;
    }
  }

  const parserAvailability = workspace.hasPackageJson ? checkParserAvailability() : { available: true, usedFallbackPath: true };

  const coverageDirs = ['coverage', '.nyc_output', 'htmlcov', '.coverage'];
  const existingCoverageDir = coverageDirs.find(d => pathExists(path.join(root, d)));

  let coverageScript = null;
  if (workspace.hasPackageJson && workspace.packageJson) {
    const scripts = workspace.packageJson.scripts || {};
    coverageScript = scripts['test:coverage'] || scripts['coverage'] || null;
  }

  const isNodeProject = workspace.hasPackageJson;
  const isJavaProject = workspace.hasJava;
  const isPythonProject = workspace.hasRequirements || workspace.hasPyproject || workspace.hasManagePy;
  const isGoProject = workspace.hasGo;
  const isRustProject = workspace.hasRust;

  const relevantChecks = ['readme', 'license', 'gitignore', 'envExample', 'editorconfig'];
  if (isNodeProject || isPythonProject || isGoProject || isRustProject || isJavaProject) {
    relevantChecks.push('testConfig');
  }
  relevantChecks.push('ci', 'dockerConfig');

  const passed = relevantChecks.filter((key) => checks[key]?.found).length;
  const total = relevantChecks.length;

  const stack = detectStack(root);
  const fixSuggestions = buildFixSuggestions(stack);
  const fixes = Object.entries(checks)
    .filter(([key, value]) => !value.found && fixSuggestions[key])
    .map(([key]) => ({ check: key, ...fixSuggestions[key] }));

  if (!parserAvailability.available && !parserAvailability.usedFallbackPath) {
    fixes.push({
      check: 'parserAvailability',
      action: 'Install @babel/parser for accurate JS/TS dependency analysis (npm install @babel/parser)',
      severity: 'high',
    });
  }

  return {
    ok: true,
    workspaceRoot: root,
    healthScore: `${passed}/${total}`,
    healthScoreNumeric: {
      passed,
      total,
      ratio: total > 0 ? passed / total : 0,
    },
    packageManager: detectNodePackageManager(root),
    checks,
    fixes,
    parserAvailability,
    stack: {
      isNode: isNodeProject,
      isJava: isJavaProject,
      isPython: isPythonProject,
      isGo: isGoProject,
      isRust: isRustProject,
    },
    testCoverage: {
      hasCoverageScript: Boolean(coverageScript),
      coverageScript,
      hasCoverageReport: Boolean(existingCoverageDir),
      coverageDir: existingCoverageDir || null,
    },
  };
}

module.exports = {
  assembleSummary,
  assembleDiff,
  assembleFile,
  assembleSecurity,
  projectHealth,
  detectTestConfig,
  resolveCompact,
  filterByCategory,
  parseCategories,
};
