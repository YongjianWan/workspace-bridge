/**
 * API contract discovery orchestration.
 *
 * Bridges two workspace containers (frontend + backend) and reports
 * matched/unmatched HTTP endpoints without modifying the core dep-graph engine.
 */

const fs = require('fs');
const path = require('path');
const { ServiceContainer } = require('../services/container');
const { warningOf } = require('../services/ledger');
const { TIMEOUTS } = require('../config/constants');
const { extractRoutes } = require('../services/dep-graph/framework-patterns');
const { extractClientCalls } = require('../services/dep-graph/api-contracts/client-call-extractor');
const { matchContracts } = require('../services/dep-graph/api-contracts/contract-matcher');
const { toRelativePosix } = require('../utils/path');
const { isTestLikeFile } = require('../utils/project-context');
const { truncateArray } = require('../utils/truncate');
const { failure, typedError } = require('../utils/failure');

async function initContainer(cwd, options = {}) {
  const container = new ServiceContainer({ quiet: true, cacheDir: options.cacheDir });
  const initialized = await container.initialize(cwd, TIMEOUTS.INIT_TIMEOUT_MS, {
    watch: false,
    strictCwd: options.strictCwd ?? true,
  });
  if (!initialized) {
    const err = container.initError || typedError('init_error', `Failed to initialize workspace container for ${cwd}`);
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
      warnings.push(warningOf('api-contract-read-error', { file: filePath, reason: 'read-error', message: err.message }));
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
  // 前端调用一条都没识别到时，"后端路由没人调"不是发现而是识别失败：
  // 此时 unmatchedServer 只是没对上的事实，拿它报 findings 会误导 agent
  // 去删实际有调用的路由（审查报告 P1-14）。
  const clientCallsRecognized = clientResult.calls.length > 0;
  const hasUnmatchedServer = clientCallsRecognized && matchResult.unmatchedServer.length > 0;
  const hasFindings = hasUnmatchedClient || hasUnmatchedServer;

  const maxFiles = Number.isFinite(options.maxFiles) && options.maxFiles > 0 ? options.maxFiles : null;
  const compact = Boolean(options.compact);
  const matchedTrunc = maxFiles ? truncateArray(matchResult.matched, maxFiles) : { items: matchResult.matched, truncated: false };
  const unmatchedClientTrunc = maxFiles ? truncateArray(matchResult.unmatchedClient, maxFiles) : { items: matchResult.unmatchedClient, truncated: false };
  const unmatchedServerTrunc = maxFiles ? truncateArray(matchResult.unmatchedServer, maxFiles) : { items: matchResult.unmatchedServer, truncated: false };
  const allWarnings = [...clientResult.warnings, ...serverResult.warnings, ...matchResult.warnings];
  if (!clientCallsRecognized) {
    allWarnings.push({
      reason: 'no-client-calls-recognized',
      message: 'No client HTTP calls recognized in the frontend; unmatched server routes are not findings. The client extractor may not cover this client style.',
    });
  }
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
 * @param {{frontend: string, backend: string, cwd?: string, quiet?: boolean}} options
 * @returns {Promise<object>}
 */
async function runApiContracts(options) {
  const baseDir = options.cwd || process.cwd();
  const frontendRoot = path.resolve(baseDir, options.frontend);
  const backendRoot = path.resolve(baseDir, options.backend);

  if (!fs.existsSync(frontendRoot) || !fs.statSync(frontendRoot).isDirectory()) {
    return failure('path_error', `Frontend path is not a directory: ${frontendRoot}`, { hasFindings: false });
  }
  if (!fs.existsSync(backendRoot) || !fs.statSync(backendRoot).isDirectory()) {
    return failure('path_error', `Backend path is not a directory: ${backendRoot}`, { hasFindings: false });
  }

  let frontendContainer = null;
  let backendContainer = null;
  let outcome;

  try {
    // Initialize sequentially to avoid global parser/cache contention.
    frontendContainer = await initContainer(frontendRoot, { cacheDir: options.cacheDir ? `${options.cacheDir}-frontend` : undefined });
    backendContainer = await initContainer(backendRoot, { cacheDir: options.cacheDir ? `${options.cacheDir}-backend` : undefined });

    const clientResult = await collectClientCalls(frontendContainer);
    const serverResult = await collectServerRoutes(backendContainer);

    outcome = buildResult(frontendRoot, backendRoot, clientResult, serverResult, options);
  } catch (err) {
    outcome = failure('unexpected_error', err.message || String(err), { hasFindings: false });
  }

  // Each container is released on its own: one failing shutdown must not leave the other open,
  // and the failure is reported, not swallowed.
  const shutdownWarnings = [];
  for (const [role, container] of [['frontend', frontendContainer], ['backend', backendContainer]]) {
    if (!container) continue;
    try {
      await container.shutdown();
    } catch (err) {
      shutdownWarnings.push(warningOf('container-shutdown-failed', { role, message: err.message || String(err) }));
    }
  }
  if (shutdownWarnings.length > 0) outcome.warnings = [...(outcome.warnings || []), ...shutdownWarnings];
  return outcome;
}

module.exports = {
  runApiContracts,
  collectClientCalls,
  collectServerRoutes,
  matchContracts,
  buildResult,
  isTestLikeFile,
};
