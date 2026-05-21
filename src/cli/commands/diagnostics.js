const { runDiagnostics } = require('../../tools/workspace-tools');

async function diagnosticsCmd(parsed, container) {
  const result = await runDiagnostics({ cwd: parsed.cwd, mode: parsed.mode }, container);
  result.hasFindings = (result.diagnosticsSummary?.total || 0) > 0;
  return result;
}

module.exports = diagnosticsCmd;
