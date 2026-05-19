const { projectHealth } = require('../../tools/health-tools');

async function healthCmd(parsed, container) {
  return projectHealth({ cwd: parsed.cwd }, container);
}

module.exports = healthCmd;
