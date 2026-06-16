const { DATA_QUALITY } = require('../../config/data-quality');
const { classifyDeadExports, attachHonesty } = require('../honesty-engine');

function deadExports(_args, container, _filePath) {
  const deadExports = container.snapshot.graph.findDeadExports();
  const classifications = classifyDeadExports(deadExports, container.snapshot.graph);
  const env = container.gitEnvironment || { dataQuality: DATA_QUALITY.CERTAIN, remediation: null };
  const result = {
    ok: true,
    deadExportsCount: deadExports.length,
    deadExports,
    dataQuality: env.dataQuality,
    ...(env.remediation ? { environmentRemediation: env.remediation } : {}),
  };
  return attachHonesty(result, 'dead_exports', classifications, container.workspaceRoot);
}

module.exports = deadExports;
