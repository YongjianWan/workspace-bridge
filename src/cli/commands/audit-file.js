const fs = require('fs');
const { dependencyGraph } = require('../../tools/dep-tools');
const { resolveWorkspaceFilePath } = require('../../utils/path');
const { buildFileSummary, buildFileValidationAdvice } = require('../../cli/formatters');
const { requireFile } = require('./_utils');

async function auditFileCmd(parsed, container) {
  requireFile(parsed, 'audit-file');
  if (parsed.watch) {
    const { startAuditFileWatch } = require('../../cli/watch');
    await startAuditFileWatch({
      cwd: parsed.cwd,
      exclude: parsed.exclude,
      targetFile: parsed.file,
      compact: parsed.compact,
    });
    return { ok: true, __managedLifecycle: true };
  }
  const resolvedPath = resolveWorkspaceFilePath(parsed.file, container.workspaceRoot);
  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    return { ok: false, error: `File not found: ${parsed.file}`, inProject: false };
  }
  const [impact, affectedTests] = await Promise.all([
    dependencyGraph({ cwd: parsed.cwd, operation: 'impact', file: parsed.file }, container),
    dependencyGraph({
      cwd: parsed.cwd,
      operation: 'affected_tests',
      file: parsed.file,
      maxDepth: Number.isFinite(parsed.maxDepth) ? parsed.maxDepth : undefined,
    }, container),
  ]);
  const frameworkPattern = container.depGraph.getFrameworkHint(resolvedPath);
  const validationAdvice = buildFileValidationAdvice(resolvedPath, container.workspaceRoot);
  return {
    ok: impact.ok !== false && affectedTests.ok !== false,
    workspaceRoot: container.workspaceRoot,
    file: parsed.file,
    resolvedPath: impact.resolvedPath || affectedTests.resolvedPath || null,
    summary: buildFileSummary(impact, affectedTests),
    frameworkPattern,
    validationAdvice,
    impact,
    affectedTests,
  };
}

module.exports = auditFileCmd;
