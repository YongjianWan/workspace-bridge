/**
 * Post-command bookkeeping shared by the one-shot CLI and the REPL (H-40).
 *
 * Both entry points must produce the same result envelope — staleness, graph
 * warnings merged in, and the dataQuality downgrade those warnings imply.
 * An entry point that skips this merge serves degraded data with no signal,
 * which for an AI consumer is the silent-degradation failure mode L1-4 forbids.
 */
async function finalizeCommandResult(container, result, { saveCache = true } = {}) {
  if (!result || typeof result !== 'object' || result.ok === false || !container) return result;
  result.staleness = container.getStaleness();
  // The REPL keeps the graph hot in memory and its watch mode owns cache
  // persistence; re-saving per query would add a SQLite write to every
  // hot-loop command for no new data (queries don't dirty the cache).
  if (saveCache) await container.cache.save();
  // Append, never assign: a command that raised its own warnings (query-*
  // content drift) would otherwise have them deleted here — the graph is
  // one source of warnings, not the only one.
  const graphWarnings = container.snapshot.graph.buildWarnings();
  result.warnings = Array.isArray(result.warnings)
    ? [...result.warnings, ...graphWarnings]
    : graphWarnings;
  result.warnings = [...new Map(result.warnings.map((warning) => [JSON.stringify(warning), warning])).values()];
  if (result.warnings.some((warning) => warning?.severity === 'high' || warning?.severity === 'medium')) {
    result.dataQuality = 'degraded';
  }
  return result;
}

module.exports = { finalizeCommandResult };
