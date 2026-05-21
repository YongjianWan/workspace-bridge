const fs = require('fs');
const { dependencyGraph } = require('../../tools/dep-tools');
const { resolveWorkspaceFilePath } = require('../../utils/path');
const { requireFile } = require('./_utils');

async function impactCmd(parsed, container) {
  requireFile(parsed, 'impact');
  const impactPath = resolveWorkspaceFilePath(parsed.file, container.workspaceRoot);
  if (!impactPath || !fs.existsSync(impactPath)) {
    return { ok: false, error: `File not found: ${parsed.file}`, inProject: false };
  }
  const result = await dependencyGraph({
    cwd: parsed.cwd,
    operation: 'impact',
    file: parsed.file,
    maxDepth: Number.isFinite(parsed.maxDepth) ? parsed.maxDepth : undefined,
  }, container);
  result.hasFindings = (result.impactCount || 0) > 0;
  return result;
}

module.exports = impactCmd;
