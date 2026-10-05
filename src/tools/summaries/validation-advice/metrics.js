/**
 * Metrics extraction from audit-diff entries.
 * Collects tests, risks, impacts, and classifications into a single metrics bag.
 */
function collectEntryMetrics(entries) {
  const directTests = new Set();
  const indirectTests = new Set();
  const turbulenceFiles = [];
  const highImpactFiles = [];
  const highCompositeFiles = [];
  const smokeFiles = [];
  const graphTouchedFiles = [];
  const nonMainlineFiles = [];

  for (const entry of entries) {
    smokeFiles.push(entry.file);
    if (entry.graphKnown) {
      graphTouchedFiles.push(entry.file);
    }

    if (entry.affectedTestsCount > 0) {
      for (const test of entry.affectedTests || []) {
        if (test.distance <= 1) {
          directTests.add(test.file);
        } else {
          indirectTests.add(test.file);
        }
      }
    }

    const isHighHistoryRisk = entry.historyRisk?.level === 'high';
    const isHighImpact = entry.impactCount >= 5;
    const isHighComposite = entry.compositeRisk?.level === 'high';

    if (isHighComposite) {
      highCompositeFiles.push({
        file: entry.file,
        reason: entry.compositeRisk.reasons?.[0] || `Composite risk score ${entry.compositeRisk.score}`,
      });
    }

    if (isHighHistoryRisk && !isHighImpact) {
      turbulenceFiles.push({
        file: entry.file,
        reason: `Changed often (${entry.historyRisk?.authorCount ?? 'unknown'} authors, ${entry.historyRisk?.commitCount ?? 'unknown'} commits) but narrow impact (${entry.impactCount} dependents)`,
      });
    } else if (isHighImpact) {
      highImpactFiles.push(entry.file);
    }

    if (!entry.classification?.isMainline) {
      nonMainlineFiles.push(entry.file);
    }
  }

  return {
    directTests,
    indirectTests,
    turbulenceFiles,
    highImpactFiles,
    highCompositeFiles,
    smokeFiles,
    graphTouchedFiles,
    nonMainlineFiles,
  };
}

module.exports = { collectEntryMetrics };
