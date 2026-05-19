const { dependencyGraph } = require('../../tools/dep-tools');

async function unresolvedCmd(parsed, container) {
  return dependencyGraph({ cwd: parsed.cwd, operation: 'unresolved' }, container);
}

module.exports = unresolvedCmd;
