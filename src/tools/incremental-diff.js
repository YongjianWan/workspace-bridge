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
      // Contract guard: getImpactRadius must return an array of objects with a `file` property.
      // If the return shape changes, skip impact expansion but keep the changed file itself.
      if (!Array.isArray(impact)) {
        if (process.env.DEBUG) {
          console.error(`[incremental-diff] getImpactRadius returned non-array for ${file}:`, typeof impact);
        }
        continue;
      }
      for (const entry of impact) {
        if (entry && typeof entry === 'object' && entry.file) {
          related.add(normalizePathKey(entry.file));
        }
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

function buildIncrementalFindings(changedFiles, container, options = {}) {
  const depGraph = container.snapshot?.graph || container.depGraph;
  const relatedSet = collectRelatedFiles(changedFiles, depGraph);

  const deadExports = filterDeadExports(depGraph.findDeadExports(), relatedSet);
  const unresolved = filterUnresolved(depGraph.findUnresolvedImports(), relatedSet);
  const cycles = filterCycles(depGraph.findCircularDependencies(), relatedSet);

  const sections = {
    deadExports: {
      ok: true,
      deadExportsCount: deadExports.length,
      deadExports,
    },
    unresolved: {
      ok: true,
      unresolvedCount: unresolved.length,
      unresolved,
    },
    cycles: {
      ok: true,
      cyclesCount: cycles.length,
      cycles,
    },
  };

  const { filterByCategory } = require('./audit-assembler');
  filterByCategory(sections, options?.category, ['deadExports', 'unresolved', 'cycles']);

  return {
    ...(sections.deadExports.omitted ? {} : {
      deadExportsCount: sections.deadExports.deadExportsCount,
      deadExports: sections.deadExports.deadExports,
    }),
    ...(sections.unresolved.omitted ? {} : {
      unresolvedCount: sections.unresolved.unresolvedCount,
      unresolved: sections.unresolved.unresolved,
    }),
    ...(sections.cycles.omitted ? {} : {
      cyclesCount: sections.cycles.cyclesCount,
      cycles: sections.cycles.cycles,
    }),
  };
}

module.exports = {
  buildIncrementalFindings,
  collectRelatedFiles,
};
