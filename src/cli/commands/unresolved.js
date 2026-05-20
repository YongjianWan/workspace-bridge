const { dependencyGraph } = require('../../tools/dep-tools');

async function unresolvedCmd(parsed, container) {
  const result = await dependencyGraph({ cwd: parsed.cwd, operation: 'unresolved' }, container);
  result.hasFindings = (result.unresolvedCount || 0) > 0;
  return result;
}

module.exports = unresolvedCmd;
