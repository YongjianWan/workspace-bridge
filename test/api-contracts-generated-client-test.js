#!/usr/bin/env node
// @fast
// @semantic
/**
 * Generated API clients do not use axios or fetch: openapi-typescript-codegen emits
 * `__request(OpenAPI, { method, url })` and hey-api emits `client.get({ url })`. Their static
 * calls are extracted; look-alike receivers stay unrecognised.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');
const { extractClientCallsFromFile } = require('../src/services/dep-graph/api-contracts/client-call-extractor');

const root = makeTempDir('wb-generated-client-');
try {
  const file = path.join(root, 'services.ts');
  fs.writeFileSync(file, [
    "export class ItemsService {",
    "  static readItems(skip = 0) {",
    "    return __request(OpenAPI, { method: 'GET', url: '/api/v1/items/', query: { skip } });",
    "  }",
    "  static createItem(body) {",
    "    return __request(OpenAPI, {",
    "      method: 'POST',",
    "      url: '/api/v1/items/',",
    "      body,",
    "    });",
    "  }",
    "}",
    "export const listUsers = () => client.get({ url: '/api/v1/users/' });",
    "export const removeUser = () => client.delete({ url: '/api/v1/users/me' });",
    "export const sendMail = () => client.request({ method: 'POST', url: '/api/v1/mail' });",
    "// look-alikes that must not match",
    "const a = otherClient.get({ url: '/not/a/call' });",
    "const b = __request(OpenAPI, { url: '/missing/method' });",
    "const c = client.get({ url: `/api/${id}` });",
    '',
  ].join(String.fromCharCode(10)));

  const { calls } = extractClientCallsFromFile(file);
  const found = calls.map((c) => `${c.method} ${c.path}`).sort();
  assert.deepStrictEqual(found, [
    'DELETE /api/v1/users/me',
    'GET /api/v1/items/',
    'GET /api/v1/users/',
    'POST /api/v1/items/',
    'POST /api/v1/mail',
  ]);
} finally {
  cleanupTempDir(root);
}
