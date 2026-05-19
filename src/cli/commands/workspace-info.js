const { workspaceInfo } = require('../../tools/workspace-tools');

async function workspaceInfoCmd(parsed, container) {
  return workspaceInfo({ cwd: parsed.cwd }, container);
}

module.exports = workspaceInfoCmd;
