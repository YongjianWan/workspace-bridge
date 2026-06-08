#!/usr/bin/env node
// @contract
// @slow — spawns CLI multiple times, ~5-6s total
/**
 * CLI integration E2E tests for Stage 3.5 query commands.
 * Covers query-hotspots, query-knowledge-risk, and query-stability.
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const { runCli, runCliRaw, runCliText, makeTempDir, cleanupTempDir, runInDir } = require('./test-helpers');
const { GraphDB } = require('../src/services/graph-db');

const createdCacheDir = !process.env.WB_TEST_CACHE_DIR;
const cacheDir = process.env.WB_TEST_CACHE_DIR || makeTempDir('wb-test-cache-root-');
process.env.WB_TEST_CACHE_DIR = cacheDir;

function writeFile(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

function initGit(root) {
  runInDir('git', ['init'], root);
  runInDir('git', ['config', 'user.email', 'test@example.com'], root);
  runInDir('git', ['config', 'user.name', 'Test User'], root);
  runInDir('git', ['add', '.'], root);
  runInDir('git', ['commit', '-m', 'init'], root);
}

function testQueryCommandsE2E() {
  console.log('Running testQueryCommandsE2E...');
  const tempRoot = makeTempDir('wb-cli-query-');
  try {
    // 1. Create a minimal workspace project
    writeFile(tempRoot, 'package.json', JSON.stringify({ name: 'query-test', version: '1.0.0' }, null, 2));
    writeFile(tempRoot, 'src/index.js', 'import "./lib.js";\nconsole.log("hello");\n');
    writeFile(tempRoot, 'src/lib.js', 'console.log("lib");\n');
    initGit(tempRoot);

    // 2. Fetch gitHead to align cache identity
    const gitHead = runInDir('git', ['rev-parse', 'HEAD'], tempRoot).trim();

    // 3. Warm up the cache
    runCli(['audit-summary', '--cwd', tempRoot, '--json', '--quiet']);

    // 4. Inject mock aggregates into the project's cache database
    const hash = crypto.createHash('md5').update(path.resolve(tempRoot)).digest('hex').slice(0, 8);
    const subCacheDir = path.join(cacheDir, hash);
    const dbPath = path.join(subCacheDir, 'cache.db');

    const mockPayload = {
      hotspots: [
        { file: 'src/index.js', score: 95.5, risk: 'high', lines: 100, churn: 10 },
        { file: 'src/lib.js', score: 45.2, risk: 'medium', lines: 50, churn: 4 }
      ],
      knowledgeRisk: {
        high: [
          { file: 'src/index.js', riskLevel: 'high', authorCount: 1, primaryAuthor: 'Test User', primaryAuthorPct: 1.0 }
        ],
        medium: [
          { file: 'src/lib.js', riskLevel: 'medium', authorCount: 2, primaryAuthor: 'Test User', primaryAuthorPct: 0.6 },
          { file: 'src/other.js', riskLevel: 'medium', authorCount: 3, primaryAuthor: 'Other User', primaryAuthorPct: 0.5 }
        ]
      },
      stability: [
        { file: 'src/index.js', cc: 8, loc: 100, assessment: 'fragile' },
        { file: 'src/lib.js', cc: 3, loc: 50, assessment: 'stable' }
      ]
    };

    // Open and write to the isolated DB
    let db = new GraphDB(dbPath);
    let rows = db.loadPrecomputedAggregates() || [];
    db.close();

    db = new GraphDB(dbPath);
    const updatedRows = rows.filter(r => r.key !== 'analysis_snapshot');
    updatedRows.push({
      key: 'analysis_snapshot',
      data: JSON.stringify(mockPayload),
      version: gitHead,
      fileCount: 2
    });
    db.savePrecomputedAggregates(updatedRows);
    db.close();

    /* =========================================================================
     * query-hotspots tests
     * ========================================================================= */
    // A. Basic JSON query
    const hsJson = runCli(['query-hotspots', '--cwd', tempRoot, '--json']);
    assert.strictEqual(hsJson.ok, true);
    assert.strictEqual(hsJson.command, 'query-hotspots');
    assert.strictEqual(hsJson.count, 2);
    assert.strictEqual(hsJson.hotspots[0].file, 'src/index.js');
    assert.strictEqual(hsJson.hotspots[1].file, 'src/lib.js');

    // B. Risk filter
    const hsHighRisk = runCli(['query-hotspots', '--cwd', tempRoot, '--risk', 'high', '--json']);
    assert.strictEqual(hsHighRisk.count, 1);
    assert.strictEqual(hsHighRisk.hotspots[0].file, 'src/index.js');

    // C. Limit constraint
    const hsLimit = runCli(['query-hotspots', '--cwd', tempRoot, '--limit', '1', '--json']);
    assert.strictEqual(hsLimit.count, 1);
    assert.strictEqual(hsLimit.hotspots[0].file, 'src/index.js');

    // D. Formatters
    const hsHuman = runCliText(['query-hotspots', '--cwd', tempRoot, '--format', 'human']);
    assert.ok(hsHuman.includes('hotspotsCount: 2'));
    assert.ok(hsHuman.includes('src/index.js | score: 95.50'));

    const hsSummary = runCliText(['query-hotspots', '--cwd', tempRoot, '--format', 'summary']);
    assert.ok(hsSummary.includes('Hotspots: 2 / 2'));

    const hsMarkdown = runCliText(['query-hotspots', '--cwd', tempRoot, '--format', 'markdown']);
    assert.ok(hsMarkdown.includes('# Query Hotspots'));
    assert.ok(hsMarkdown.includes('| src/index.js | 95.50 |'));

    const hsJsonl = runCliText(['query-hotspots', '--cwd', tempRoot, '--format', 'jsonl']);
    const hsJsonlLines = hsJsonl.trim().split('\n');
    assert.strictEqual(hsJsonlLines.length, 3);
    const hsJsonlFirst = JSON.parse(hsJsonlLines[0]);
    assert.strictEqual(hsJsonlFirst._type, 'summary');
    assert.strictEqual(hsJsonlFirst.command, 'query-hotspots');
    const hsJsonlSecond = JSON.parse(hsJsonlLines[1]);
    assert.strictEqual(hsJsonlSecond._type, 'hotspot');
    assert.strictEqual(hsJsonlSecond.file, 'src/index.js');

    const hsAi = runCliText(['query-hotspots', '--cwd', tempRoot, '--format', 'ai']);
    const hsAiParsed = JSON.parse(hsAi);
    assert.strictEqual(hsAiParsed.counts?.hotspots, 2);
    assert.strictEqual(hsAiParsed.topRisks[0]?.category, 'hotspots');

    /* =========================================================================
     * query-knowledge-risk tests
     * ========================================================================= */
    // A. Basic JSON query
    const krJson = runCli(['query-knowledge-risk', '--cwd', tempRoot, '--json']);
    assert.strictEqual(krJson.ok, true);
    assert.strictEqual(krJson.command, 'query-knowledge-risk');
    assert.strictEqual(krJson.level, 'high');
    assert.strictEqual(krJson.count, 1);
    assert.strictEqual(krJson.files[0].file, 'src/index.js');

    // B. Level filter
    const krMedium = runCli(['query-knowledge-risk', '--cwd', tempRoot, '--level', 'medium', '--json']);
    assert.strictEqual(krMedium.level, 'medium');
    assert.strictEqual(krMedium.count, 2);
    assert.strictEqual(krMedium.files[0].file, 'src/lib.js');
    assert.strictEqual(krMedium.files[1].file, 'src/other.js');

    // C. Limit constraint
    const krLimit = runCli(['query-knowledge-risk', '--cwd', tempRoot, '--level', 'medium', '--limit', '1', '--json']);
    assert.strictEqual(krLimit.count, 1);
    assert.strictEqual(krLimit.files[0].file, 'src/lib.js');

    // C.2 Invalid limit constraint
    const krInvalidLimit = runCliRaw(['query-knowledge-risk', '--cwd', tempRoot, '--level', 'medium', '--limit', '0']);
    assert.strictEqual(krInvalidLimit.status, 1);
    assert.ok(krInvalidLimit.stderr.includes('Invalid --limit value'));

    // D. Formatters
    const krHuman = runCliText(['query-knowledge-risk', '--cwd', tempRoot, '--level', 'medium', '--format', 'human']);
    assert.ok(krHuman.includes('knowledgeRiskCount: 2'));
    assert.ok(krHuman.includes('src/lib.js | risk: medium'));

    const krSummary = runCliText(['query-knowledge-risk', '--cwd', tempRoot, '--level', 'high', '--format', 'summary']);
    assert.ok(krSummary.includes('Knowledge Risk (high): 1 / 1'));

    const krMarkdown = runCliText(['query-knowledge-risk', '--cwd', tempRoot, '--level', 'high', '--format', 'markdown']);
    assert.ok(krMarkdown.includes('# Query Knowledge Risk'));

    const krJsonl = runCliText(['query-knowledge-risk', '--cwd', tempRoot, '--level', 'high', '--format', 'jsonl']);
    const krJsonlLines = krJsonl.trim().split('\n');
    assert.strictEqual(krJsonlLines.length, 2);
    const krJsonlFirst = JSON.parse(krJsonlLines[0]);
    assert.strictEqual(krJsonlFirst._type, 'summary');
    assert.strictEqual(krJsonlFirst.command, 'query-knowledge-risk');
    const krJsonlSecond = JSON.parse(krJsonlLines[1]);
    assert.strictEqual(krJsonlSecond._type, 'knowledge-risk-item');
    assert.strictEqual(krJsonlSecond.file, 'src/index.js');

    const krAi = runCliText(['query-knowledge-risk', '--cwd', tempRoot, '--level', 'high', '--format', 'ai']);
    const krAiParsed = JSON.parse(krAi);
    assert.strictEqual(krAiParsed.counts?.knowledgeRisk, 1);

    /* =========================================================================
     * query-stability tests
     * ========================================================================= */
    // A. Basic JSON query
    const stJson = runCli(['query-stability', '--cwd', tempRoot, '--json']);
    assert.strictEqual(stJson.ok, true);
    assert.strictEqual(stJson.command, 'query-stability');
    assert.strictEqual(stJson.count, 2);

    // B. Assessment filter
    const stFragile = runCli(['query-stability', '--cwd', tempRoot, '--assessment', 'fragile', '--json']);
    assert.strictEqual(stFragile.count, 1);
    assert.strictEqual(stFragile.files[0].file, 'src/index.js');

    // C. Limit constraint
    const stLimit = runCli(['query-stability', '--cwd', tempRoot, '--limit', '1', '--json']);
    assert.strictEqual(stLimit.count, 1);

    // D. Formatters
    const stHuman = runCliText(['query-stability', '--cwd', tempRoot, '--format', 'human']);
    assert.ok(stHuman.includes('stabilityCount: 2'));
    assert.ok(stHuman.includes('src/index.js | cc: 8 | loc: 100 | assessment: fragile'));

    const stSummary = runCliText(['query-stability', '--cwd', tempRoot, '--format', 'summary']);
    assert.ok(stSummary.includes('Stability: 2 / 2'));

    const stMarkdown = runCliText(['query-stability', '--cwd', tempRoot, '--format', 'markdown']);
    assert.ok(stMarkdown.includes('# Query Stability'));

    const stJsonl = runCliText(['query-stability', '--cwd', tempRoot, '--format', 'jsonl']);
    const stJsonlLines = stJsonl.trim().split('\n');
    assert.strictEqual(stJsonlLines.length, 3);
    const stJsonlFirst = JSON.parse(stJsonlLines[0]);
    assert.strictEqual(stJsonlFirst._type, 'summary');
    assert.strictEqual(stJsonlFirst.command, 'query-stability');
    const stJsonlSecond = JSON.parse(stJsonlLines[1]);
    assert.strictEqual(stJsonlSecond._type, 'stability-item');
    assert.strictEqual(stJsonlSecond.file, 'src/index.js');

    const stAi = runCliText(['query-stability', '--cwd', tempRoot, '--format', 'ai']);
    const stAiParsed = JSON.parse(stAi);
    assert.strictEqual(stAiParsed.counts?.stability, 2);

  } finally {
    cleanupTempDir(tempRoot);
  }
}

function main() {
  try {
    testQueryCommandsE2E();
  } finally {
    if (createdCacheDir) {
      cleanupTempDir(cacheDir);
    }
  }
  console.log('cli-integration-query-test.js: all passed');
}

main();
