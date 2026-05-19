const { dependencyGraph } = require('../../tools/dep-tools');

async function statsCmd(parsed, container) {
  return dependencyGraph({ cwd: parsed.cwd, operation: 'stats' }, container);
}

module.exports = statsCmd;
