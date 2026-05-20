const { requireFile } = require('./_utils');
const { assembleFile } = require('../../tools/audit-assembler');

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
  return assembleFile(parsed, container);
}

module.exports = auditFileCmd;
