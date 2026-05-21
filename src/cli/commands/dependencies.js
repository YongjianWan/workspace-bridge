const fs = require('fs');
const { dependencyGraph } = require('../../tools/dep-tools');
const { resolveWorkspaceFilePath } = require('../../utils/path');
const { requireFile } = require('./_utils');

async function dependenciesCmd(parsed, container) {
  requireFile(parsed, 'dependencies');
  const depPath = resolveWorkspaceFilePath(parsed.file, container.workspaceRoot);
  if (!depPath || !fs.existsSync(depPath)) {
    return { ok: false, error: `File not found: ${parsed.file}`, inProject: false };
  }
  const result = await dependencyGraph({ cwd: parsed.cwd, operation: 'dependencies', file: parsed.file }, container);
  result.hasFindings = (result.dependenciesCount || 0) > 0;
  return result;
}

module.exports = dependenciesCmd;
