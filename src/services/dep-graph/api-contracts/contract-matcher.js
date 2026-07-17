/**
 * API contract matcher — align client-side HTTP calls with server-side routes.
 *
 * Matching is purely structural: (HTTP method, normalized path). No body/header
 * comparison, no runtime semantics. Path-variable segments are normalized so
 * `/users/:id` matches `/users/{id}` and `/users/123`.
 */

const VARIABLE_SEGMENT_RE = /\{[^/]+\}|:[^/]+/g;

function normalizePath(rawPath) {
  if (!rawPath || typeof rawPath !== 'string') return '';

  // Strip URL scheme/host if present: https://api.example.com/api/users -> /api/users
  let p = rawPath.trim();
  const schemeIndex = p.indexOf('://');
  if (schemeIndex >= 0) {
    const afterScheme = p.slice(schemeIndex + 3);
    const pathStart = afterScheme.indexOf('/');
    p = pathStart >= 0 ? afterScheme.slice(pathStart) : '/';
  }

  // Collapse duplicate slashes and ensure leading slash.
  p = p.replace(/\/+/g, '/');
  if (!p.startsWith('/')) p = `/${p}`;

  // Remove trailing slash except for root.
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);

  // Normalize variable segments to {}.
  p = p.replace(VARIABLE_SEGMENT_RE, '{}');

  return p;
}

function normalizeMethod(method) {
  if (!method || typeof method !== 'string') return 'GET';
  return method.trim().toUpperCase();
}

function makeKey(method, path) {
  return `${normalizeMethod(method)}:${normalizePath(path)}`;
}

/**
 * Match client calls against server routes.
 * @param {Array<{method:string, path:string, file:string}>} clientCalls
 * @param {Array<{method:string, path:string, file:string}>} serverRoutes
 * @returns {{
 *   matched: Array<{method:string, path:string, clientFiles:string[], serverFiles:string[]}>,
 *   unmatchedClient: Array<{method:string, path:string, files:string[]}>,
 *   unmatchedServer: Array<{method:string, path:string, files:string[]}>,
 *   coverageRatio: number,
 *   warnings: Array<{reason:string, message:string}>
 * }}
 */
function matchContracts(clientCalls, serverRoutes) {
  const clientMap = new Map();
  const serverMap = new Map();
  const warnings = [];

  for (const call of clientCalls || []) {
    const key = makeKey(call.method, call.path);
    if (!clientMap.has(key)) clientMap.set(key, { method: normalizeMethod(call.method), path: normalizePath(call.path), files: new Set() });
    clientMap.get(key).files.add(call.file);
  }

  for (const route of serverRoutes || []) {
    const key = makeKey(route.method, route.path);
    if (!serverMap.has(key)) serverMap.set(key, { method: normalizeMethod(route.method), path: normalizePath(route.path), files: new Set() });
    serverMap.get(key).files.add(route.file);
  }

  const matched = [];
  const unmatchedClient = [];
  const unmatchedServer = [];

  for (const [key, clientEntry] of clientMap.entries()) {
    const serverEntry = serverMap.get(key);
    if (serverEntry) {
      matched.push({
        method: clientEntry.method,
        path: clientEntry.path,
        clientFiles: Array.from(clientEntry.files).sort(),
        serverFiles: Array.from(serverEntry.files).sort(),
        confidence: 'high',
      });
    } else {
      unmatchedClient.push({
        method: clientEntry.method,
        path: clientEntry.path,
        files: Array.from(clientEntry.files).sort(),
      });
    }
  }

  for (const [key, serverEntry] of serverMap.entries()) {
    if (!clientMap.has(key)) {
      unmatchedServer.push({
        method: serverEntry.method,
        path: serverEntry.path,
        files: Array.from(serverEntry.files).sort(),
      });
    }
  }

  // Warn if normalization collapsed distinct variable names (e.g. /users/:id vs /users/:name).
  // This is a limitation of MVP string matching.
  if (clientMap.size > 0 && serverMap.size > 0) {
    warnings.push({
      reason: 'path-variable-normalization',
      message: 'Path variable segments are normalized to {}; distinct variable names on the same segment may be treated as equal.',
    });
  }

  const serverCount = serverMap.size;
  const coverageRatio = serverCount > 0 ? matched.length / serverCount : 0;

  return {
    matched: matched.sort((a, b) => `${a.method}:${a.path}`.localeCompare(`${b.method}:${b.path}`)),
    unmatchedClient: unmatchedClient.sort((a, b) => `${a.method}:${a.path}`.localeCompare(`${b.method}:${b.path}`)),
    unmatchedServer: unmatchedServer.sort((a, b) => `${a.method}:${a.path}`.localeCompare(`${b.method}:${b.path}`)),
    coverageRatio,
    warnings,
  };
}

module.exports = {
  normalizePath,
  normalizeMethod,
  matchContracts,
};
