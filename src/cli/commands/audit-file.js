const fs = require('fs');
const { requireFile } = require('./_utils');
const { resolveWorkspaceFilePath } = require('../../utils/path');
const { assembleFile } = require('../../tools/audit-assembler');
const { failure } = require('../../utils/failure');

async function auditFileCmd(parsed, container) {
  requireFile(parsed, 'audit-file');
  if (container) {
    const filePath = resolveWorkspaceFilePath(parsed.file, container.workspaceRoot);
    if (!filePath || !fs.existsSync(filePath)) {
      return failure('path_error', `File not found: ${parsed.file}`, { suggestion: '--file is resolved relative to --cwd; check the path, or pass --cwd for the workspace that contains it.', inProject: false, hasFindings: false });
    }
    if (fs.statSync(filePath).isDirectory()) {
      return failure('path_error', `Path is a directory, not a file: ${parsed.file}`, { inProject: true, hasFindings: false });
    }
  }
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
  return assembleFile(parsed, container);
}

module.exports = auditFileCmd;
