// @fast
// @semantic
const assert = require('assert');
const { formatAi } = require('../src/cli/formatters');
const candidate = { file: '/repo/UserDTO.js', source: 'same-stem', confidence: 'low', coChangeCount: 0, dataQuality: 'certain' };
const impact = { ok: true, impactCount: 1, graphImpactCount: 0, impact: [candidate] };
for (const [command, result] of [['impact', impact], ['audit-file', { ok: true, impact, affectedTests: { affectedTestsCount: 0, affectedTests: [] } }]]) {
  const ai = JSON.parse(formatAi(command, result));
  assert(ai.confidence.overall <= 0.5, `${command}: inferred candidates cannot become certain in the AI envelope`);
  assert(ai.topRisks.every(risk => risk.confidence <= 0.5), `${command}: candidate risk must remain low confidence`);
  assert(!JSON.stringify(ai.topRisks).includes('would affect'), `${command}: candidate must not imply a proven impact`);
  const surface = JSON.parse(formatAi(command, result, { depth: 'surface' }));
  assert(surface.topRisks.some(risk => risk.category === 'impact-candidates'), 'surface must preserve the candidate category');
}
const mixed = JSON.parse(formatAi('impact', { ...impact, impactCount: 2, graphImpactCount: 1, impact: [{ file: '/repo/Dep.js', level: 1 }, candidate] }));
assert.strictEqual(mixed.topRisks.find(risk => risk.category === 'impact').count, 1);
assert.strictEqual(mixed.topRisks.find(risk => risk.category === 'impact-candidates').count, 1);
console.log('impact AI confidence contracts passed');
