// @contract
// @slow — initializes ServiceContainer 6 times, ~6-7s total
const assert = require('assert');
const { queryHotspots, queryKnowledgeRisk, queryStability } = require('../src/tools/query-tools');
const { ServiceContainer } = require('../src/services/container');

async function withContainer(fn) {
  const container = new ServiceContainer();
  await container.initialize(process.cwd(), 30000);
  try {
    return await fn(container);
  } finally {
    await container.shutdown();
  }
}

async function testQueryHotspotsReturnsData() {
  const result = await withContainer((c) => queryHotspots({}, c));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.command, 'query-hotspots');
  assert.ok(Array.isArray(result.hotspots));
  assert.ok(result.count > 0);
}

async function testQueryHotspotsFiltersByRisk() {
  const result = await withContainer((c) => queryHotspots({ risk: 'high' }, c));
  assert.strictEqual(result.ok, true);
  for (const h of result.hotspots) {
    assert.strictEqual(h.risk, 'high');
  }
}

async function testQueryHotspotsRespectsLimit() {
  const result = await withContainer((c) => queryHotspots({ limit: 2 }, c));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.count, 2);
  assert.strictEqual(result.hotspots.length, 2);
}

async function testQueryKnowledgeRisk() {
  const result = await withContainer((c) => queryKnowledgeRisk({ level: 'high', limit: 5 }, c));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.command, 'query-knowledge-risk');
  assert.ok(Array.isArray(result.files));
  assert.ok(result.count <= 5);
}

async function testQueryStability() {
  const result = await withContainer((c) => queryStability({ limit: 5 }, c));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.command, 'query-stability');
  assert.ok(Array.isArray(result.files));
  assert.ok(result.count <= 5);
}

async function testQueryStabilityFiltersByAssessment() {
  const result = await withContainer((c) => queryStability({ assessment: 'moderate', limit: 3 }, c));
  assert.strictEqual(result.ok, true);
  for (const s of result.files) {
    assert.strictEqual(s.assessment, 'moderate');
  }
}

async function main() {
  await testQueryHotspotsReturnsData();
  await testQueryHotspotsFiltersByRisk();
  await testQueryHotspotsRespectsLimit();
  await testQueryKnowledgeRisk();
  await testQueryStability();
  await testQueryStabilityFiltersByAssessment();
  console.log('query-tools-test: all passed');
}

main();
