const { runDiagnostics } = require('../../tools/workspace-tools');

async function diagnosticsCmd(parsed, container) {
  return runDiagnostics({ cwd: parsed.cwd, mode: parsed.mode }, container);
}

module.exports = diagnosticsCmd;
