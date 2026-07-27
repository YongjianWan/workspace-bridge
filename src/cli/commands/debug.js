/**
 * debug — internal diagnostic commands for development and verification.
 */
// Cap the duplicate list so a pathological repo cannot explode the payload.
const MAX_DEBUG_DUPLICATE_SYMBOLS = 50;

async function debugCmd(parsed, container) {
  await container.ensureReady();

  const what = parsed.what || 'registry';

  if (what === 'symbols') {
    const registry = container.snapshot?.graph?.symbolRegistry;
    if (!registry) {
      return { ok: false, error: 'Symbol registry not available' };
    }
    const stats = registry.getRegistryStats();
    // Registry owns the definition of "duplicate" (exported-from-2+-files);
    // walking registry.exports here would report private declarations and
    // disagree with stats.duplicateSymbols in the same payload.
    const duplicates = registry.getDuplicateSymbols();

    return {
      ok: true,
      what: 'symbols',
      stats,
      duplicates: duplicates.slice(0, MAX_DEBUG_DUPLICATE_SYMBOLS),
      duplicateCount: duplicates.length,
    };
  }

  if (what === 'graph') {
    const graph = container.snapshot?.graph;
    if (!graph) {
      return { ok: false, error: 'Dependency graph not available' };
    }
    const files = graph.getAllFilePaths?.() || [];
    const MAX_DEBUG_GRAPH_FILES = 5000;
    const MAX_DEBUG_GRAPH_EDGES = 50000;
    let edgeCount = 0;
    let truncated = false;
    const filesToScan = files.length > MAX_DEBUG_GRAPH_FILES ? files.slice(0, MAX_DEBUG_GRAPH_FILES) : files;
    for (const file of filesToScan) {
      edgeCount += (graph.getDependencies?.(file) || []).length;
      if (edgeCount > MAX_DEBUG_GRAPH_EDGES) {
        truncated = true;
        break;
      }
    }
    return {
      ok: true,
      what: 'graph',
      fileCount: files.length,
      edgeCount,
      truncated,
      sampleFiles: files.slice(0, 10),
    };
  }

  return { ok: false, error: `Unknown debug target: ${what}. Supported: symbols, graph` };
}

module.exports = debugCmd;
