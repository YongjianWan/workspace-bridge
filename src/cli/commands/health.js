const { projectHealth } = require('../../tools/health-tools');

async function healthCmd(parsed, container) {
  const result = await projectHealth({ cwd: parsed.cwd }, container);
  result.hasFindings = (result.healthScoreNumeric?.ratio || 1) < 1;
  return result;
}

module.exports = healthCmd;
