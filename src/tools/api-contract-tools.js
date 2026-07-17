/**
 * API contract discovery orchestration.
 *
 * Bridges two workspace containers (frontend + backend) and reports
 * matched/unmatched HTTP endpoints without modifying the core dep-graph engine.
 */

const fs = require('fs');
const path = require('path');
const { ServiceContainer } = require('../services/container');
const { TIMEOUTS } = require('../config/constants');
const { extractRoutes } = require('../services/dep-graph/framework-patterns');
const { extractClientCalls } = require('../services/dep-graph/api-contracts/client-call-extractor');
const { matchContracts } = require('../services/dep-graph/api-contracts/contract-matcher');
const { toRelativePosix } = require('../utils/path');
const { isTestLikeFile } = require('../utils/project-context');
const { truncateArray } = require('../utils/truncate');

async function initContainer(cwd, options = {}) {
  const container = new ServiceContainer({ quiet: true, cacheDir: options.cacheDir });
  const initialized = await container.initialize(cwd, TIMEOUTS.INIT_TIMEOUT_MS, {
    watch: false,
    strictCwd: options.strictCwd ?? true,
  });
  if (!initialized) {
    const err = container.initError || new Error(`Failed to initialize workspace container for ${cwd}`);
    await container.shutdown();
    throw err;
  }
  return container;
}

async function collectServerRoutes(container) {
  const graph = container.snapshot?.graph;
  if (!graph) return { routes: [], warnings: [] };

  const filePaths = graph.getAllFilePaths().filter((p) => !isTestLikeFile(p));
  const routes = [];
  const warnings = [];

  for (const filePath of filePaths) {
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      warnings.push({ file: filePath, reason: 'read-error', message: err.message });
      continue;
    }

    const fileRoutes = await extractRoutes(filePath, content);
    if (!fileRoutes) continue;

    for (const route of fileRoutes) {
      routes.push({
        method: route.method || 'ALL',
        path: route.path,
        file: toRelativePosix(container.workspaceRoot, filePath),
        framework: route.framework || null,
      });
    }
  }

  return { routes, warnings };
}

async function collectClientCalls(container) {
  const graph = container.snapshot?.graph;
  if (!graph) return { calls: [], warnings: [] };

  const filePaths = graph.getAllFilePaths().filter((p) => !isTestLikeFile(p));
  const result = extractClientCalls(filePaths);
  const root = container.workspaceRoot;
  for (const call of result.calls) {
    call.file = toRelativePosix(root, call.file);
  }
  for (const warning of result.warnings) {
    warning.file = toRelativePosix(root, warning.file);
  }
  return result;
}

function buildResult(frontendRoot, backendRoot, clientResult, serverResult, options = {}) {
  const matchResult = matchContracts(clientResult.calls, serverResult.routes);

  const hasUnmatchedClient = matchResult.unmatchedClient.length > 0;
  const hasUnmatchedServer = matchResult.unmatchedServer.length > 0;
  const hasFindings = hasUnmatchedClient || hasUnmatchedServer;

  const maxFiles = Number.isFinite(options.maxFiles) && options.maxFiles > 0 ? options.maxFiles : null;
  const compact = Boolean(options.compact);
  const matchedTrunc = maxFiles ? truncateArray(matchResult.matched, maxFiles) : { items: matchResult.matched, truncated: false };
  const unmatchedClientTrunc = maxFiles ? truncateArray(matchResult.unmatchedClient, maxFiles) : { items: matchResult.unmatchedClient, truncated: false };
  const unmatchedServerTrunc = maxFiles ? truncateArray(matchResult.unmatchedServer, maxFiles) : { items: matchResult.unmatchedServer, truncated: false };
  const allWarnings = [...clientResult.warnings, ...serverResult.warnings, ...matchResult.warnings];
  const warningsTrunc = maxFiles ? truncateArray(allWarnings, maxFiles) : { items: allWarnings, truncated: false };

  return {
    ok: true,
    command: 'api-contracts',
    frontend: frontendRoot,
    backend: backendRoot,
    clientCallsCount: clientResult.calls.length,
    serverRoutesCount: serverResult.routes.length,
    matchedCount: matchResult.matched.length,
    unmatchedClientCount: matchResult.unmatchedClient.length,
    unmatchedServerCount: matchResult.unmatchedServer.length,
    coverageRatio: Number(matchResult.coverageRatio.toFixed(2)),
    matched: compact ? [] : matchedTrunc.items,
    unmatchedClient: compact ? [] : unmatchedClientTrunc.items,
    unmatchedServer: compact ? [] : unmatchedServerTrunc.items,
    warnings: compact ? [] : warningsTrunc.items,
    compact,
    truncated: !compact && (matchedTrunc.truncated || unmatchedClientTrunc.truncated || unmatchedServerTrunc.truncated || warningsTrunc.truncated),
    hasFindings,
  };
}

/**
 * Run API contract discovery between a frontend and backend workspace.
 * @param {{frontend: string, backend: string, quiet?: boolean}} options
 * @returns {Promise<object>}
 */
async function runApiContracts(options) {
  const frontendRoot = path.resolve(options.frontend);
  const backendRoot = path.resolve(options.backend);

  if (!fs.existsSync(frontendRoot) || !fs.statSync(frontendRoot).isDirectory()) {
    return { ok: false, error: `Frontend path is not a directory: ${frontendRoot}`, hasFindings: false };
  }
  if (!fs.existsSync(backendRoot) || !fs.statSync(backendRoot).isDirectory()) {
    return { ok: false, error: `Backend path is not a directory: ${backendRoot}`, hasFindings: false };
  }

  let frontendContainer = null;
  let backendContainer = null;

  try {
    // Initialize sequentially to avoid global parser/cache contention.
    frontendContainer = await initContainer(frontendRoot, { cacheDir: options.cacheDir ? `${options.cacheDir}-frontend` : undefined });
    backendContainer = await initContainer(backendRoot, { cacheDir: options.cacheDir ? `${options.cacheDir}-backend` : undefined });

    const clientResult = await collectClientCalls(frontendContainer);
    const serverResult = await collectServerRoutes(backendContainer);

    return buildResult(frontendRoot, backendRoot, clientResult, serverResult, options);
  } catch (err) {
    return { ok: false, error: err.message || String(err), hasFindings: false };
  } finally {
    if (frontendContainer) await frontendContainer.shutdown();
    if (backendContainer) await backendContainer.shutdown();
  }
}

module.exports = {
  runApiContracts,
  collectClientCalls,
  collectServerRoutes,
  matchContracts,
  buildResult,
  isTestLikeFile,
};
