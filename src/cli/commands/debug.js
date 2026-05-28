/**
 * debug — internal diagnostic commands for development and verification.
 */
async function debugCmd(parsed, container) {
  await container.ensureReady();

  const what = parsed.what || 'registry';

  if (what === 'symbols') {
    const registry = container.snapshot?.graph?.symbolRegistry;
    if (!registry) {
      return { ok: false, error: 'Symbol registry not available' };
    }
    const stats = registry.getRegistryStats();
    const duplicates = [];
    for (const [name, locations] of registry.exports) {
      if (locations.length > 1) {
        duplicates.push({ name, count: locations.length, files: locations.map((l) => l.file) });
      }
    }
    // Sort by count desc, limit to top 50 to avoid output explosion
    duplicates.sort((a, b) => b.count - a.count);
    const topDuplicates = duplicates.slice(0, 50);

    return {
      ok: true,
      what: 'symbols',
      stats,
      duplicates: topDuplicates,
      duplicateCount: duplicates.length,
    };
  }

  if (what === 'graph') {
    const graph = container.snapshot?.graph;
    if (!graph) {
      return { ok: false, error: 'Dependency graph not available' };
    }
    const files = graph.getAllFilePaths?.() || [];
    let edgeCount = 0;
    for (const file of files) {
      edgeCount += (graph.getDependencies?.(file) || []).length;
    }
    return {
      ok: true,
      what: 'graph',
      fileCount: files.length,
      edgeCount,
      sampleFiles: files.slice(0, 10),
    };
  }

  return { ok: false, error: `Unknown debug target: ${what}. Supported: symbols, graph` };
}

module.exports = debugCmd;
