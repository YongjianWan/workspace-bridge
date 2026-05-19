const fs = require('fs');
const { treeQuery } = require('../../tools/tree-tools');
const { resolveWorkspaceFilePath } = require('../../utils/path');
const { requireFile } = require('./_utils');

async function treeCmd(parsed, container) {
  requireFile(parsed, 'tree');
  const treePath = resolveWorkspaceFilePath(parsed.file, container.workspaceRoot);
  if (!treePath || !fs.existsSync(treePath)) {
    return { ok: false, error: `File not found: ${parsed.file}`, inProject: false };
  }
  return treeQuery({
    cwd: parsed.cwd,
    file: treePath,
    depth: Number.isFinite(parsed.maxDepth) ? parsed.maxDepth : undefined,
    direction: parsed.direction || 'both',
  }, container);
}

module.exports = treeCmd;
