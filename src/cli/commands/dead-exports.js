const { dependencyGraph } = require('../../tools/dep-tools');

async function deadExportsCmd(parsed, container) {
  const result = await dependencyGraph({ cwd: parsed.cwd, operation: 'dead_exports' }, container);
  result.hasFindings = (result.deadExportsCount || 0) > 0;
  return result;
}

module.exports = deadExportsCmd;
