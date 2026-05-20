const { dependencyGraph } = require('../../tools/dep-tools');

async function cyclesCmd(parsed, container) {
  const result = await dependencyGraph({ cwd: parsed.cwd, operation: 'cycles' }, container);
  result.hasFindings = (result.cyclesCount || 0) > 0;
  return result;
}

module.exports = cyclesCmd;
