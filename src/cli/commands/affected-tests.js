const fs = require('fs');
const { dependencyGraph } = require('../../tools/dep-tools');
const { resolveWorkspaceFilePath } = require('../../utils/path');
const { requireFile } = require('./_utils');

async function affectedTestsCmd(parsed, container) {
  requireFile(parsed, 'affected-tests');
  const atPath = resolveWorkspaceFilePath(parsed.file, container.workspaceRoot);
  if (!atPath || !fs.existsSync(atPath)) {
    return { ok: false, error: `File not found: ${parsed.file}`, inProject: false };
  }
  const result = await dependencyGraph({
    cwd: parsed.cwd,
    operation: 'affected_tests',
    file: parsed.file,
    maxDepth: Number.isFinite(parsed.maxDepth) ? parsed.maxDepth : undefined,
  }, container);
  result.hasFindings = (result.affectedTestsCount || 0) > 0;
  return result;
}

module.exports = affectedTestsCmd;
