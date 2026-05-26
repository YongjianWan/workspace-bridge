const fs = require('fs');
const { requireFile } = require('./_utils');
const { resolveWorkspaceFilePath } = require('../../utils/path');
const { assembleFile } = require('../../tools/audit-assembler');

async function auditFileCmd(parsed, container) {
  requireFile(parsed, 'audit-file');
  const filePath = resolveWorkspaceFilePath(parsed.file, container.workspaceRoot);
  if (!filePath || !fs.existsSync(filePath)) {
    return { ok: false, error: `File not found: ${parsed.file}`, inProject: false, hasFindings: false };
  }
  if (fs.statSync(filePath).isDirectory()) {
    return { ok: false, error: `Path is a directory, not a file: ${parsed.file}`, inProject: true, hasFindings: false };
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
