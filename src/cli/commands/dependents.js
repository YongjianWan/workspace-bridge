const fs = require('fs');
const { dependencyGraph } = require('../../tools/dep-tools');
const { resolveWorkspaceFilePath } = require('../../utils/path');
const { requireFile } = require('./_utils');

async function dependentsCmd(parsed, container) {
  requireFile(parsed, 'dependents');
  const dentPath = resolveWorkspaceFilePath(parsed.file, container.workspaceRoot);
  if (!dentPath || !fs.existsSync(dentPath)) {
    return { ok: false, error: `File not found: ${parsed.file}`, inProject: false };
  }
  return dependencyGraph({ cwd: parsed.cwd, operation: 'dependents', file: parsed.file }, container);
}

module.exports = dependentsCmd;
