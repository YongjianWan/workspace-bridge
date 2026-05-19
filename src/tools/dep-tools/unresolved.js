const { classifyUnresolved, attachHonesty } = require('../honesty-engine');

function unresolved(_args, container, _filePath) {
  const unresolved = container.depGraph.findUnresolvedImports();
  const classifications = classifyUnresolved(unresolved, container.workspaceRoot);
  const result = {
    ok: true,
    unresolvedCount: unresolved.length,
    unresolved,
  };
  return attachHonesty(result, 'unresolved', classifications, container.workspaceRoot);
}

module.exports = unresolved;
