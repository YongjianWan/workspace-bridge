/**
 * Dependency graph tools - Fixed version with proper path handling
 */
const { resolveWorkspaceFilePath } = require('../utils/path');
const { DEFAULTS } = require('../config/constants');

async function dependencyGraph(args, container) {
  await container.ensureReady();
  
  if (!container.depGraph) {
    return { ok: false, error: 'Dependency graph not available' };
  }

  const operation = args?.operation || 'stats';
  const root = container.workspaceRoot;
  
  // Resolve file path to absolute for consistent lookup
  const filePath = args?.file ? resolveWorkspaceFilePath(args.file, root) : null;

  switch (operation) {
    case 'stats':
      return {
        ok: true,
        stats: container.depGraph.getStats(),
      };
    
    case 'dependencies':
      if (!filePath) return { ok: false, error: 'file is required for dependencies' };
      const deps = container.depGraph.getDependencies(filePath);
      return {
        ok: true,
        file: args.file,
        resolvedPath: filePath,
        dependencyCount: deps.length,
        dependencies: deps,
      };
    
    case 'dependents':
      if (!filePath) return { ok: false, error: 'file is required for dependents' };
      const dents = container.depGraph.getDependents(filePath);
      return {
        ok: true,
        file: args.file,
        resolvedPath: filePath,
        dependentCount: dents.length,
        dependents: dents,
      };
    
    case 'impact':
      if (!filePath) return { ok: false, error: 'file is required for impact analysis' };
      const impact = container.depGraph.getImpactRadius(filePath);
      const symbolImpact = container.depGraph.getSymbolImpact(filePath);
      return {
        ok: true,
        file: args.file,
        resolvedPath: filePath,
        impactCount: impact.length,
        impact,
        symbolImpact,
      };
    
    case 'cycles':
      const cycles = container.depGraph.findCircularDependencies();
      return {
        ok: true,
        cycleCount: cycles.length,
        cycles,
      };
    
    // Phase 3: 跨文件分析查询
    case 'dead_exports':
      const deadExports = container.depGraph.findDeadExports();
      return {
        ok: true,
        deadExportCount: deadExports.length,
        deadExports,
      };
    
    case 'unresolved':
      const unresolved = container.depGraph.findUnresolvedImports();
      return {
        ok: true,
        unresolvedCount: unresolved.length,
        unresolved,
      };
    
    case 'affected_tests':
      if (!filePath) return { ok: false, error: 'file is required for affected_tests' };
      const maxDepth = Number.isFinite(args?.maxDepth) ? Math.max(1, args.maxDepth) : DEFAULTS.AFFECTED_TEST_DEPTH;
      const affectedTests = container.depGraph.findAffectedTests(filePath, maxDepth);
      return {
        ok: true,
        source: args.file,
        resolvedPath: filePath,
        maxDepth,
        affectedTestCount: affectedTests.length,
        affectedTests,
      };
    
    default:
      return { ok: false, error: `Unknown operation: ${operation}` };
  }
}

module.exports = {
  dependencyGraph,
};
