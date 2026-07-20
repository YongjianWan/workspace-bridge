const { DATA_QUALITY } = require('../../config/data-quality');
const { LIMITS } = require('../../config/constants');

function cycles(_args, container, _filePath) {
  const graph = container.snapshot.graph;
  const allCycles = graph.findCircularDependencies();
  const meta = typeof graph.getCycleMeta === 'function'
    ? graph.getCycleMeta()
    : { sccCount: null, truncated: false };
  const env = container.gitEnvironment || { dataQuality: DATA_QUALITY.CERTAIN, remediation: null };
  const shown = allCycles.slice(0, LIMITS.OUTPUT_EXTRA_LONG);
  return {
    ok: true,
    // cyclesCount keeps its historical meaning (enumerated path count).
    // sccCount is the curated signal: how many strongly connected components
    // form cycles. A single dense SCC can yield 100+ paths but is ONE problem.
    cyclesCount: allCycles.length,
    sccCount: meta.sccCount,
    cycles: shown,
    totalPaths: allCycles.length,
    truncated: meta.truncated || shown.length < allCycles.length,
    dataQuality: env.dataQuality,
    ...(env.remediation ? { environmentRemediation: env.remediation } : {}),
  };
}

module.exports = cycles;
