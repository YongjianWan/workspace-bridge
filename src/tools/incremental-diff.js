/**
 * Incremental diff curation for audit-diff --incremental.
 *
 * Instead of comparing against a persisted baseline snapshot (which adds
 * complexity and consistency risk), we compute "incremental" as range
 * filtering: only keep findings that touch the changed files or their
 * immediate impact radius. This gives AI only the noise that matters.
 */

const { normalizePathKey } = require('../utils/path');

const IMPACT_RADIUS_DEPTH = 2;

function collectRelatedFiles(changedFiles, depGraph) {
  const related = new Set();
  for (const file of changedFiles) {
    if (!file) continue;
    const normalized = normalizePathKey(file);
    related.add(normalized);
    try {
      const impact = depGraph.getImpactRadius(file, IMPACT_RADIUS_DEPTH);
      for (const entry of impact) {
        if (entry.file) related.add(normalizePathKey(entry.file));
      }
    } catch {
      // If impact radius fails for one file, still include the file itself.
    }
  }
  return related;
}

function filterDeadExports(deadExports, relatedSet) {
  return deadExports.filter((e) => relatedSet.has(normalizePathKey(e.file)));
}

function filterUnresolved(unresolved, relatedSet) {
  return unresolved.filter((u) => relatedSet.has(normalizePathKey(u.file)));
}

function filterCycles(cycles, relatedSet) {
  return cycles.filter((cycle) => cycle.some((f) => relatedSet.has(normalizePathKey(f))));
}

function buildIncrementalFindings(changedFiles, container) {
  const depGraph = container.depGraph;
  const relatedSet = collectRelatedFiles(changedFiles, depGraph);

  const deadExports = filterDeadExports(depGraph.findDeadExports(), relatedSet);
  const unresolved = filterUnresolved(depGraph.findUnresolvedImports(), relatedSet);
  const cycles = filterCycles(depGraph.findCircularDependencies(), relatedSet);

  return {
    deadExportsCount: deadExports.length,
    deadExports,
    unresolvedCount: unresolved.length,
    unresolved,
    cyclesCount: cycles.length,
    cycles,
  };
}

module.exports = {
  buildIncrementalFindings,
  collectRelatedFiles,
};
