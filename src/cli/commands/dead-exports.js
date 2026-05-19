const { dependencyGraph } = require('../../tools/dep-tools');

async function deadExportsCmd(parsed, container) {
  return dependencyGraph({ cwd: parsed.cwd, operation: 'dead_exports' }, container);
}

module.exports = deadExportsCmd;
