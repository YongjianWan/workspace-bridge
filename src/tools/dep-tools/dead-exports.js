const { classifyDeadExports, attachHonesty } = require('../honesty-engine');

function deadExports(_args, container, _filePath) {
  const deadExports = container.depGraph.findDeadExports();
  const classifications = classifyDeadExports(deadExports, container.depGraph);
  const result = {
    ok: true,
    deadExportsCount: deadExports.length,
    deadExports,
  };
  return attachHonesty(result, 'dead_exports', classifications, container.workspaceRoot);
}

module.exports = deadExports;
