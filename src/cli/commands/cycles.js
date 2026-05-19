const { dependencyGraph } = require('../../tools/dep-tools');

async function cyclesCmd(parsed, container) {
  return dependencyGraph({ cwd: parsed.cwd, operation: 'cycles' }, container);
}

module.exports = cyclesCmd;
