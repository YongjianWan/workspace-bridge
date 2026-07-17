#!/usr/bin/env node
// @semantic
// Tests for api-contracts cross-workspace endpoint alignment.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { rmSync } = require('fs');
const { extractClientCallsFromFile } = require('../src/services/dep-graph/api-contracts/client-call-extractor');
const { matchContracts, normalizePath } = require('../src/services/dep-graph/api-contracts/contract-matcher');
const { runApiContracts, buildResult } = require('../src/tools/api-contract-tools');
const { formatHuman, formatSummary, formatMarkdown, formatJsonl, formatAi } = require('../src/cli/formatters');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFiles(dir, files) {
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf8');
  }
}

function cleanup(dir) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

function testAxiosShorthandExtraction() {
  const dir = makeTempDir('wb-api-contracts-client-');
  const file = path.join(dir, 'api.ts');
  fs.writeFileSync(file, `
import axios from 'axios';
export function list() { return axios.get('/api/items'); }
export function create() { return axios.post('/api/items'); }
export function remove(id) { return axios.delete(\`/api/items/\${id}\`); }
`, 'utf8');

  const result = extractClientCallsFromFile(file);
  assert.strictEqual(result.calls.length, 2, 'should extract static axios shorthand calls');
  assert(result.calls.some((c) => c.method === 'GET' && c.path === '/api/items'));
  assert(result.calls.some((c) => c.method === 'POST' && c.path === '/api/items'));
  assert(result.warnings.length > 0, 'should warn on template-literal URL');
  cleanup(dir);
}

function testFetchExtraction() {
  const dir = makeTempDir('wb-api-contracts-fetch-');
  const file = path.join(dir, 'api.ts');
  fs.writeFileSync(file, `
export function list() { return fetch('/api/items'); }
export function create() { return fetch('/api/items', { method: 'POST' }); }
`, 'utf8');

  const result = extractClientCallsFromFile(file);
  assert.strictEqual(result.calls.length, 2, 'should extract fetch calls');
  assert(result.calls.some((c) => c.method === 'GET' && c.path === '/api/items'));
  assert(result.calls.some((c) => c.method === 'POST' && c.path === '/api/items'));
  cleanup(dir);
}

function testAxiosConfigExtraction() {
  const dir = makeTempDir('wb-api-contracts-config-');
  const file = path.join(dir, 'api.ts');
  fs.writeFileSync(file, `
import axios from 'axios';
export function update(id) {
  return axios({ method: 'PUT', url: '/api/items/' + id });
}
export function patch(id) {
  return axios({ url: '/api/items/' + id, method: 'PATCH' });
}
`, 'utf8');

  const result = extractClientCallsFromFile(file);
  // Dynamic URL concatenation is skipped.
  assert.strictEqual(result.calls.length, 0, 'should skip dynamic URL concatenation');
  cleanup(dir);
}

function testTemplateLiteralWithoutInterpolation() {
  const dir = makeTempDir('wb-api-contracts-template-');
  const file = path.join(dir, 'api.ts');
  fs.writeFileSync(file, `
import axios from 'axios';
export function list() { return axios.get(\`/api/items\`); }
export function detail() { return fetch(\`/api/items/1\`); }
`, 'utf8');

  const result = extractClientCallsFromFile(file);
  assert.strictEqual(result.calls.length, 2, 'should extract un-interpolated template-literal URLs');
  assert(result.calls.some((c) => c.method === 'GET' && c.path === '/api/items'));
  assert(result.calls.some((c) => c.method === 'GET' && c.path === '/api/items/1'));
  cleanup(dir);
}

function testCommentedCodeIgnored() {
  const dir = makeTempDir('wb-api-contracts-comments-');
  const file = path.join(dir, 'api.ts');
  fs.writeFileSync(file, `
import axios from 'axios';
// axios.get('/api/commented');
/*
fetch('/api/block-comment');
*/
export function list() { return axios.get('/api/items'); }
`, 'utf8');

  const result = extractClientCallsFromFile(file);
  assert.strictEqual(result.calls.length, 1, 'should ignore HTTP calls inside comments');
  assert.strictEqual(result.calls[0].path, '/api/items');
  cleanup(dir);
}

function testAxiosConfigNarrowMatching() {
  const dir = makeTempDir('wb-api-contracts-narrow-');
  const file = path.join(dir, 'api.ts');
  fs.writeFileSync(file, `
const apiConfig = { url: '/api/false-positive', method: 'POST' };
const myApi = { request: (cfg: any) => cfg };
myApi.request({ url: '/api/also-false', method: 'GET' });
export function real() { return axios({ url: '/api/real', method: 'GET' }); }
`, 'utf8');

  const result = extractClientCallsFromFile(file);
  assert.strictEqual(result.calls.length, 1, 'should only match literal axios config calls');
  assert.strictEqual(result.calls[0].path, '/api/real');
  cleanup(dir);
}

function testNormalizePath() {
  assert.strictEqual(normalizePath('https://api.example.com/api/users'), '/api/users');
  assert.strictEqual(normalizePath('/api/users/'), '/api/users');
  assert.strictEqual(normalizePath('api/users'), '/api/users');
  assert.strictEqual(normalizePath('/api/users/:id'), '/api/users/{}');
  assert.strictEqual(normalizePath('/api/users/{userId}'), '/api/users/{}');
}

function testMatchContracts() {
  const clients = [
    { method: 'GET', path: '/api/users', file: 'client/api.ts' },
    { method: 'POST', path: '/api/users', file: 'client/api.ts' },
    { method: 'GET', path: '/api/ghost', file: 'client/api.ts' },
  ];
  const servers = [
    { method: 'GET', path: '/api/users', file: 'server/routes.js' },
    { method: 'POST', path: '/api/users', file: 'server/routes.js' },
    { method: 'DELETE', path: '/api/users/:id', file: 'server/routes.js' },
  ];
  const result = matchContracts(clients, servers);
  assert.strictEqual(result.matched.length, 2, 'GET and POST /api/users should match');
  assert.strictEqual(result.unmatchedClient.length, 1, '/api/ghost has no server route');
  assert.strictEqual(result.unmatchedServer.length, 1, 'DELETE /api/users/:id has no client call');
  assert.strictEqual(result.coverageRatio, 2 / 3);
}

async function testEndToEndAlignment() {
  const frontendDir = makeTempDir('wb-api-contracts-fe-');
  const backendDir = makeTempDir('wb-api-contracts-be-');
  try {
    writeFiles(frontendDir, {
      'src/api/user.ts': `
import axios from 'axios';
export async function listUsers() { return axios.get('/api/users'); }
export async function createUser(data) { return axios.post('/api/users', data); }
export async function ghostCall() { return axios.get('/api/ghost'); }
`,
    });
    writeFiles(backendDir, {
      'src/controller/userController.js': `
const express = require('express');
const router = express.Router();
router.get('/api/users', (req, res) => res.json([]));
router.get('/api/users/:id', (req, res) => res.json({ id: req.params.id }));
router.post('/api/users', (req, res) => res.status(201).json(req.body));
router.delete('/api/users/:id', (req, res) => res.status(204).send());
module.exports = router;
`,
    });

    const result = await runApiContracts({ frontend: frontendDir, backend: backendDir });
    assert.strictEqual(result.ok, true, `runApiContracts failed: ${result.error}`);
    assert.strictEqual(result.clientCallsCount, 3, 'should find 3 client calls');
    assert.strictEqual(result.serverRoutesCount, 4, 'should find 4 server routes');
    assert.strictEqual(result.matchedCount, 2, 'GET and POST /api/users should match');
    assert.strictEqual(result.unmatchedClientCount, 1, 'only /api/ghost unmatched');
    assert.strictEqual(result.unmatchedServerCount, 2, 'GET /api/users/:id and DELETE /api/users/:id unmatched');
    assert.strictEqual(result.coverageRatio, 0.5, '2/4 server routes covered');
    assert.strictEqual(result.hasFindings, true);

    const matchedPaths = result.matched.map((m) => `${m.method} ${m.path}`).sort();
    assert.deepStrictEqual(matchedPaths, ['GET /api/users', 'POST /api/users']);

    const unmatchedClientPaths = result.unmatchedClient.map((u) => `${u.method} ${u.path}`).sort();
    assert.deepStrictEqual(unmatchedClientPaths, ['GET /api/ghost']);
  } finally {
    cleanup(frontendDir);
    cleanup(backendDir);
  }
}

async function testMissingArguments() {
  const result = await runApiContracts({ frontend: '/nonexistent-dir-12345', backend: '/nonexistent-dir-67890' });
  assert.strictEqual(result.ok, false, 'should fail for missing directories');
}

function testFormatterShowsWarnings() {
  const result = {
    ok: true,
    frontend: '/fe',
    backend: '/be',
    clientCallsCount: 1,
    serverRoutesCount: 1,
    matchedCount: 0,
    unmatchedClientCount: 1,
    unmatchedServerCount: 1,
    coverageRatio: 0,
    matched: [],
    unmatchedClient: [{ method: 'GET', path: '/api/x', files: ['a.ts'] }],
    unmatchedServer: [{ method: 'GET', path: '/api/y', files: ['b.js'] }],
    warnings: [{ reason: 'dynamic-url-skipped', message: 'Template-literal URLs with interpolation are not statically extractable', file: 'a.ts' }],
  };

  const human = formatHuman('api-contracts', result);
  assert(human.includes('warnings'), 'human formatter should show warnings');

  const summary = formatSummary('api-contracts', result);
  assert(summary.includes('Warnings'), 'summary formatter should show warnings');

  const markdown = formatMarkdown('api-contracts', result);
  assert(markdown.includes('## Warnings'), 'markdown formatter should show warnings');

  const jsonl = formatJsonl('api-contracts', result);
  const lines = jsonl.split('\n').filter(Boolean).map(JSON.parse);
  assert(lines.some((r) => r._type === 'warning'), 'jsonl formatter should emit warning records');
}

function testAiFormatDigest() {
  const result = {
    ok: true,
    clientCallsCount: 2,
    serverRoutesCount: 2,
    matchedCount: 1,
    unmatchedClientCount: 1,
    unmatchedServerCount: 1,
    coverageRatio: 0.5,
    matched: [{ method: 'GET', path: '/api/users', clientFiles: ['src/api.ts'], serverFiles: ['src/routes.js'], confidence: 'high' }],
    unmatchedClient: [{ method: 'GET', path: '/api/ghost', files: ['src/api.ts'] }],
    unmatchedServer: [{ method: 'DELETE', path: '/api/users/{}', files: ['src/routes.js'] }],
    warnings: [{ reason: 'path-variable-normalization', message: 'Path variable segments are normalized to {}' }],
  };

  const ai = JSON.parse(formatAi('api-contracts', result, { depth: 'detail' }));
  assert.strictEqual(ai.command, 'api-contracts');
  assert.strictEqual(ai.severity, 'high', 'unmatched client calls should raise severity to high');
  assert.strictEqual(ai.counts.matched, 1);
  assert.strictEqual(ai.counts.unmatchedClient, 1);
  assert(ai.topRisks.some((r) => r.category === 'unmatched-client'), 'ai digest should flag unmatched client calls');
  assert(ai.actions.length > 0, 'ai digest should suggest actions');
  assert(Array.isArray(ai.details.matched), 'ai detail should include details.matched');
  assert(Array.isArray(ai.details.unmatchedClient), 'ai detail should include details.unmatchedClient');

  const full = JSON.parse(formatAi('api-contracts', result, { depth: 'full' }));
  assert.strictEqual(full.details.matched.length, 1, 'full depth should return complete matched list');

  const surface = JSON.parse(formatAi('api-contracts', result, { depth: 'surface' }));
  assert.strictEqual(surface.severity, 'high');
  assert(surface.topRisks.some((r) => r.category === 'unmatched-client'), 'surface should keep top-level risk');
  assert(!surface.details, 'surface should omit detailed contract lists');
}

function testAiDigestForOtherCommands() {
  const statsResult = { ok: true, stats: { files: 100, totalImports: 200, totalExports: 150, cycles: 2, analysisCoverage: { coverageRatio: 0.9 } } };
  const statsAi = JSON.parse(formatAi('stats', statsResult, { depth: 'surface' }));
  assert.strictEqual(statsAi.counts.files, 100);
  assert(statsAi.topRisks.some((r) => r.category === 'cycles'), 'stats ai should flag cycles');

  const wsResult = { ok: true, fileCount: 50, detected: { node: true, python: false }, languages: { javascript: 48, python: 2 }, availableChecks: ['npm scripts'] };
  const wsAi = JSON.parse(formatAi('workspace-info', wsResult, { depth: 'detail' }));
  assert.strictEqual(wsAi.counts.fileCount, 50);
  assert.deepStrictEqual(wsAi.details.detected, ['node'], 'workspace-info ai should include detected stacks');

  const depResult = { ok: true, file: 'src/a.js', dependenciesCount: 3, dependencies: ['b.js', 'c.js', 'd.js'] };
  const depAi = JSON.parse(formatAi('dependencies', depResult, { depth: 'detail' }));
  assert.strictEqual(depAi.counts.dependencies, 3);
  assert.strictEqual(depAi.details.target, 'src/a.js');

  const dptResult = { ok: true, file: 'src/a.js', dependentsCount: 25, dependents: Array.from({ length: 25 }, (_, i) => `test/${i}.js`) };
  const dptAi = JSON.parse(formatAi('dependents', dptResult, { depth: 'surface' }));
  assert.strictEqual(dptAi.counts.dependents, 25);
  assert(dptAi.topRisks.some((r) => r.category === 'high-fan-in'), 'dependents ai should flag high fan-in');

  const mapResult = { ok: true, summary: { issueCounts: { deadExports: 4, unresolved: 1, cycles: 0, orphans: 2, hotspots: 10 }, nextSteps: ['Review dead exports'] } };
  const mapAi = JSON.parse(formatAi('audit-map', mapResult, { depth: 'surface' }));
  assert.strictEqual(mapAi.counts.deadExports, 4);
  assert(mapAi.topRisks.some((r) => r.category === 'dead-exports'), 'audit-map ai should flag dead exports');

  const diagnosticsResult = { ok: true, checksRun: 3, failedChecks: ['lint'], diagnosticsSummary: { total: 5, error: 1, warning: 2 }, results: [{ name: 'eslint', ok: false, diagnosticsCount: 5, error: 'timeout' }], noLintersDetected: false };
  const diagnosticsAi = JSON.parse(formatAi('diagnostics', diagnosticsResult, { depth: 'detail' }));
  assert.strictEqual(diagnosticsAi.counts.diagnostics, 5);
  assert(diagnosticsAi.topRisks.some((r) => r.category === 'diagnostic-failure'), 'diagnostics ai should flag failed checks');
  assert(diagnosticsAi.topRisks.some((r) => r.category === 'diagnostics'), 'diagnostics ai should flag issues');
  assert(Array.isArray(diagnosticsAi.details.results), 'diagnostics ai should include results detail');

  const healthResult = { ok: true, workspaceRoot: '/project', summary: { severity: 'low', recommendations: [] }, skeleton: { totalFiles: 20, mainlineFiles: 15 }, aggregates: { hotspotsByRisk: { high: 0 }, stabilityCounts: { fragile: 0 } }, orphans: { counts: { total: 0 } }, healthScoreNumeric: { passed: 4, total: 5, ratio: 0.8 } };
  const healthAi = JSON.parse(formatAi('health', healthResult, { depth: 'surface' }));
  assert.strictEqual(healthAi.command, 'health');
  assert.strictEqual(healthAi.counts.healthScore, 0.8, 'health ai should expose health score');

  const treeResult = { ok: true, file: 'src/a.js', tree: { file: 'src/a.js', imports: [{ file: 'src/b.js' }, { file: 'src/c.js', circular: true }], dependents: [{ file: 'src/d.js' }] }, truncated: false };
  const treeAi = JSON.parse(formatAi('tree', treeResult, { depth: 'detail' }));
  assert.strictEqual(treeAi.counts.imports, 2);
  assert.strictEqual(treeAi.counts.dependents, 1);
  assert.strictEqual(treeAi.counts.circular, 1);
  assert(treeAi.topRisks.some((r) => r.category === 'cycles'), 'tree ai should flag circular edges');
  assert.strictEqual(treeAi.details.target, 'src/a.js');

  const queryResult = { ok: true, count: 2, rows: [{ id: 1, file: 'a.js' }, { id: 2, file: 'b.js' }], truncated: false };
  const queryAi = JSON.parse(formatAi('query', queryResult, { depth: 'detail' }));
  assert.strictEqual(queryAi.counts.rows, 2);
  assert.deepStrictEqual(queryAi.details.columns, ['id', 'file']);
  assert.strictEqual(queryAi.details.rows.length, 2);
}

function testBuildResultMaxFiles() {
  const clientResult = {
    calls: [
      { method: 'GET', path: '/api/a', file: 'src/a.js' },
      { method: 'POST', path: '/api/b', file: 'src/b.js' },
      { method: 'GET', path: '/api/c', file: 'src/c.js' },
    ],
    warnings: [{ reason: 'dynamic', message: 'skipped dynamic URL', file: 'src/d.js' }],
  };
  const serverResult = {
    routes: [
      { method: 'GET', path: '/api/a', file: 'server/a.js', framework: 'express' },
      { method: 'POST', path: '/api/b', file: 'server/b.js', framework: 'express' },
      { method: 'GET', path: '/api/d', file: 'server/d.js', framework: 'express' },
    ],
    warnings: [],
  };
  const full = buildResult('/frontend', '/backend', clientResult, serverResult);
  assert.strictEqual(full.matched.length, 2);
  assert.strictEqual(full.unmatchedClient.length, 1);
  assert.strictEqual(full.unmatchedServer.length, 1);
  assert.strictEqual(full.truncated, false);

  const capped = buildResult('/frontend', '/backend', clientResult, serverResult, { maxFiles: 1 });
  assert.strictEqual(capped.matched.length, 1, 'matched should be capped');
  assert.strictEqual(capped.unmatchedClient.length, 1, 'unmatchedClient should be capped');
  assert.strictEqual(capped.unmatchedServer.length, 1, 'unmatchedServer should be capped');
  assert.strictEqual(capped.warnings.length, 1, 'warnings should be capped');
  assert.strictEqual(capped.matchedCount, 2, 'matchedCount should reflect total');
  assert.strictEqual(capped.unmatchedClientCount, 1, 'unmatchedClientCount should reflect total');
  assert.strictEqual(capped.truncated, true, 'truncated flag should be true');
}

function testBuildResultCompact() {
  const clientResult = {
    calls: [{ method: 'GET', path: '/api/a', file: 'src/a.js' }],
    warnings: [{ reason: 'dynamic', message: 'skipped dynamic URL', file: 'src/d.js' }],
  };
  const serverResult = {
    routes: [{ method: 'GET', path: '/api/a', file: 'server/a.js', framework: 'express' }],
    warnings: [],
  };
  const compact = buildResult('/frontend', '/backend', clientResult, serverResult, { compact: true });
  assert.deepStrictEqual(compact.matched, [], 'matched should be empty in compact mode');
  assert.deepStrictEqual(compact.unmatchedClient, [], 'unmatchedClient should be empty in compact mode');
  assert.deepStrictEqual(compact.unmatchedServer, [], 'unmatchedServer should be empty in compact mode');
  assert.deepStrictEqual(compact.warnings, [], 'warnings should be empty in compact mode');
  assert.strictEqual(compact.matchedCount, 1, 'matchedCount should still reflect total');
  assert.strictEqual(compact.clientCallsCount, 1, 'clientCallsCount should still reflect total');
  assert.strictEqual(compact.compact, true, 'compact flag should be true');

  const human = formatHuman('api-contracts', compact);
  assert(human.includes('compact mode'), 'human formatter should mention compact mode');
  const summary = formatSummary('api-contracts', compact);
  assert(summary.includes('Compact mode'), 'summary formatter should mention compact mode');
  const markdown = formatMarkdown('api-contracts', compact);
  assert(markdown.includes('Compact mode'), 'markdown formatter should mention compact mode');
}

async function main() {
  testAxiosShorthandExtraction();
  testFetchExtraction();
  testAxiosConfigExtraction();
  testTemplateLiteralWithoutInterpolation();
  testCommentedCodeIgnored();
  testAxiosConfigNarrowMatching();
  testFormatterShowsWarnings();
  testAiFormatDigest();
  testAiDigestForOtherCommands();
  testNormalizePath();
  testMatchContracts();
  testBuildResultMaxFiles();
  testBuildResultCompact();
  await testEndToEndAlignment();
  await testMissingArguments();
  console.log('api-contracts-test.js: all passed');
}

main().catch((err) => {
  console.error('api-contracts-test.js failed:', err.message);
  process.exit(1);
});
