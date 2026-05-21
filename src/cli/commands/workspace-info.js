const { workspaceInfo } = require('../../tools/workspace-tools');

async function workspaceInfoCmd(parsed, container) {
  const result = workspaceInfo({ cwd: parsed.cwd }, container);
  result.hasFindings = false;
  return result;
}

module.exports = workspaceInfoCmd;
