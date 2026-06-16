const { DATA_QUALITY } = require('../../config/data-quality');
const { classifyUnresolved, attachHonesty } = require('../honesty-engine');

function unresolved(_args, container, _filePath) {
  const unresolved = container.snapshot.graph.findUnresolvedImports();
  const classifications = classifyUnresolved(unresolved, container.workspaceRoot);
  const env = container.gitEnvironment || { dataQuality: DATA_QUALITY.CERTAIN, remediation: null };
  const result = {
    ok: true,
    unresolvedCount: unresolved.length,
    unresolved,
    dataQuality: env.dataQuality,
    ...(env.remediation ? { environmentRemediation: env.remediation } : {}),
  };
  return attachHonesty(result, 'unresolved', classifications, container.workspaceRoot);
}

module.exports = unresolved;
