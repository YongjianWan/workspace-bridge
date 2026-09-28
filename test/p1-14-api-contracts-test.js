#!/usr/bin/env node
// @semantic
/**
 * P1-14：api-contracts 不认 OpenAPI 生成客户端的调用，且前端调用识别为 0
 * 时把"N 个后端路由没人调"报成发现。
 *
 * 生成客户端（openapi-typescript-codegen 一类）不走 axios，而是调用本地
 * request({ url, method }) / this.request({ path, method })。修复前这类
 * 调用一条都提取不出来；调用数为 0 时 hasFindings 应为 false 并给出
 * "没识别到调用"的警告，而不是把后端路由全报成无人调用。
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { extractClientCallsFromFile } = require('../src/services/dep-graph/api-contracts/client-call-extractor');
const { buildResult } = require('../src/tools/api-contract-tools');

function withTempJs(content, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-p14-'));
  const file = path.join(dir, 'client.ts');
  fs.writeFileSync(file, content);
  try {
    return fn(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function testGeneratedClientRequestCall() {
  const result = withTempJs(
    `export async function listUsers() {\n  return request({ url: '/api/v1/users', method: 'GET' });\n}\n`,
    (file) => extractClientCallsFromFile(file)
  );
  const call = result.calls.find((c) => c.path === '/api/v1/users');
  assert.ok(call, `request({url,method}) should be extracted, got: ${JSON.stringify(result.calls)}`);
  assert.strictEqual(call.method, 'GET');
}

function testThisRequestWithPath() {
  const result = withTempJs(
    `class ItemsService {\n  create() { return this.request({ path: '/api/v1/items', method: 'POST' }); }\n}\n`,
    (file) => extractClientCallsFromFile(file)
  );
  const call = result.calls.find((c) => c.path === '/api/v1/items');
  assert.ok(call, `this.request({path,method}) should be extracted, got: ${JSON.stringify(result.calls)}`);
  assert.strictEqual(call.method, 'POST');
}

function testRequestObjectWithoutMethodNotExtracted() {
  const result = withTempJs(
    `const cfg = request({ url: '/api/v1/mystery' });\n`,
    (file) => extractClientCallsFromFile(file)
  );
  assert(
    !result.calls.some((c) => c.path === '/api/v1/mystery'),
    `request({url}) without method is too ambiguous to treat as an HTTP call, got: ${JSON.stringify(result.calls)}`
  );
}

function testZeroClientCallsIsNotAFinding() {
  const clientResult = { calls: [], warnings: [] };
  const serverResult = { routes: [
    { method: 'GET', path: '/api/v1/users', file: 'routes.py' },
    { method: 'POST', path: '/api/v1/items', file: 'routes.py' },
  ], warnings: [] };

  const result = buildResult('/fe', '/be', clientResult, serverResult);
  assert.strictEqual(result.clientCallsCount, 0);
  assert.strictEqual(
    result.hasFindings, false,
    'zero recognized client calls must not be reported as findings (routes are uncalled only if calls were recognized)'
  );
  assert(
    (result.warnings || []).some((w) => w.reason === 'no-client-calls-recognized'),
    `expected a no-client-calls-recognized warning, got: ${JSON.stringify(result.warnings)}`
  );
}

function testUnmatchedServerStillFindingsWhenCallsExist() {
  const clientResult = { calls: [{ method: 'GET', path: '/api/v1/users', file: 'a.ts' }], warnings: [] };
  const serverResult = { routes: [
    { method: 'GET', path: '/api/v1/users', file: 'routes.py' },
    { method: 'DELETE', path: '/api/v1/items', file: 'routes.py' },
  ], warnings: [] };

  const result = buildResult('/fe', '/be', clientResult, serverResult);
  assert.strictEqual(result.hasFindings, true, 'uncalled route with recognized calls must stay a finding');
  assert(
    !(result.warnings || []).some((w) => w.reason === 'no-client-calls-recognized'),
    'no-client-calls-recognized warning must not fire when calls exist'
  );
}

function main() {
  testGeneratedClientRequestCall();
  testThisRequestWithPath();
  testRequestObjectWithoutMethodNotExtracted();
  testZeroClientCallsIsNotAFinding();
  testUnmatchedServerStillFindingsWhenCallsExist();
  console.log('p1-14-api-contracts-test: PASS');
}

main();
