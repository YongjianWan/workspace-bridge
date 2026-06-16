const { DATA_QUALITY } = require('../../config/data-quality');

function cycles(_args, container, _filePath) {
  const cycles = container.snapshot.graph.findCircularDependencies();
  const env = container.gitEnvironment || { dataQuality: DATA_QUALITY.CERTAIN, remediation: null };
  return {
    ok: true,
    cyclesCount: cycles.length,
    cycles,
    dataQuality: env.dataQuality,
    ...(env.remediation ? { environmentRemediation: env.remediation } : {}),
  };
}

module.exports = cycles;
