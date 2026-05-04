/**
 * workspace-bridge watch
 * File watcher that prints impact radius on every save.
 * Reuses REPL container initialization (watch: true), drops readline,
 * and registers a callback on file changes.
 */
const path = require('path');
const { ServiceContainer } = require('../services/container');
const { DEFAULTS, TIMEOUTS } = require('../config/constants');

function formatWatchOutput(workspaceRoot, filePath, impact, depGraph, compact) {
  const relativeFile = path.relative(workspaceRoot, filePath);
  const count = impact.length;

  if (!compact || count <= 10) {
    const list = impact.map((e) => path.relative(workspaceRoot, e.file)).join(', ');
    return `${relativeFile} changed  ${count} dependents affected: [${list}]`;
  }

  // Compact curation: show entries + tests explicitly, aggregate the rest.
  const entrySet = depGraph.entryFiles || new Set();
  const entries = [];
  const tests = [];
  let otherCount = 0;

  for (const item of impact) {
    if (entrySet.has(item.file)) {
      entries.push(path.relative(workspaceRoot, item.file));
    } else if (depGraph.isTestLikeFile?.(item.file)) {
      tests.push(path.relative(workspaceRoot, item.file));
    } else {
      otherCount++;
    }
  }

  const parts = [`${count} dependents`];
  if (entries.length > 0) parts.push(`entries: [${entries.join(', ')}]`);
  if (tests.length > 0) parts.push(`tests: [${tests.join(', ')}]`);
  if (otherCount > 0) parts.push(`+${otherCount} more`);

  return `${relativeFile} changed  ${parts.join(', ')}`;
}

function registerWatchCallback(fileIndex, depGraph, workspaceRoot, compact) {
  fileIndex.onFileChanged = (filePath) => {
    const startTime = Date.now();
    const impact = depGraph.getImpactRadius(filePath, DEFAULTS.WATCH_IMPACT_DEPTH);
    console.log(formatWatchOutput(workspaceRoot, filePath, impact, depGraph, compact));
    if (process.env.DEBUG) {
      console.error(`[watch] computed in ${Date.now() - startTime}ms`);
    }
  };
}

function setupGracefulShutdown(container) {
  let shuttingDown = false;
  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await container.shutdown();
    } catch (e) {
      console.error('Shutdown error:', e.message);
    }
    process.exit(0);
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function startWatch(options) {
  const container = new ServiceContainer();
  setupGracefulShutdown(container);

  try {
    const initialized = await container.initialize(options.cwd, TIMEOUTS.INIT_TIMEOUT_MS, {
      watch: true,
      excludeDirs: options.exclude || [],
    });
    if (!initialized) {
      throw container.initError || new Error('Failed to initialize workspace container');
    }

    console.error(`workspace-bridge watch — ${container.workspaceRoot}`);
    console.error('Watching for file changes. Press Ctrl+C to stop.\n');

    registerWatchCallback(
      container.fileIndex,
      container.depGraph,
      container.workspaceRoot,
      options.compact,
    );

    await new Promise(() => {});
  } catch (err) {
    console.error('Watch failed:', err.message);
    process.exitCode = 1;
  }
}

module.exports = {
  startWatch,
  formatWatchOutput,
};
