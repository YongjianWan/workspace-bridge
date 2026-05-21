const { dependencyGraph } = require('../../tools/dep-tools');

async function statsCmd(parsed, container) {
  const result = await dependencyGraph({ cwd: parsed.cwd, operation: 'stats' }, container);
  result.hasFindings = false;
  return result;
}

module.exports = statsCmd;
