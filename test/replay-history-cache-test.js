// @fast
// @semantic
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { makeTempDir, cleanupTempDir } = require('./test-helpers');

const root = makeTempDir('wb-replay-history-');
const originalSpawn = cp.spawnSync;
const commands = [];
cp.spawnSync = function (command, args, options) {
  commands.push({ command, args });
  return originalSpawn.call(this, command, args, options);
};
const { readImpactHistory } = require('../src/tools/impact-ranking');
const { analyzeCoChanges } = require('../src/tools/cochange-tools');
const { analyzeGitEnvironment } = require('../src/utils/git-environment-probe');
const git = (...args) => {
  const result = originalSpawn('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 60000 });
  assert.strictEqual(result.status, 0, result.stderr);
  return result.stdout.trim();
};
const headChecks = () => commands.filter(({ args }) => args.includes('rev-parse') && args.includes('HEAD'));
const envChecks = () => commands.filter(({ args }) => args.includes('--is-inside-work-tree'));
const logs = () => commands.filter(({ args }) => args.includes('log'));
const pairs = ['js', 'py', 'java', 'go', 'rs', 'vue'].map(ext => [`input.${ext}`, `partner.${ext}`]);
function container() {
  let environment;
  return {
    workspaceRoot: root,
    get gitEnvironment() {
      if (!environment) environment = analyzeGitEnvironment(root);
      return environment;
    },
  };
}
function assertPairs(data) {
  for (const [input, partner] of pairs) {
    const key = [input, partner].sort().join('|');
    assert.strictEqual(data.pairCounts.get(key), 1, `fixed revision must preserve ${input} history`);
  }
}

try {
  git('init', '-q');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.com');
  for (const files of pairs) for (const file of files) fs.writeFileSync(path.join(root, file), '// fixture\n');
  git('add', '.');
  git('commit', '-qm', 'initial pairs');
  const parent = git('rev-parse', 'HEAD');
  const fixed = container();
  commands.length = 0;
  const first = readImpactHistory(fixed, parent);
  assertPairs(first);
  assert.strictEqual(headChecks().length, 0, 'declared fixed parent must avoid querying HEAD');
  assert.strictEqual(envChecks().length, 1, 'fixed parent and container must share one environment probe');
  assert.strictEqual(logs().length, 1);
  assert.strictEqual(first.dataQuality, fixed.gitEnvironment.dataQuality);
  assert.deepStrictEqual(first.remediation, fixed.gitEnvironment.remediation);
  commands.length = 0;
  assert.strictEqual(readImpactHistory(fixed, parent), first);
  assert.strictEqual(commands.length, 0, 'repeated fixed-parent inputs must reuse stamped history without git');

  const dynamic = container();
  commands.length = 0;
  const interactive = readImpactHistory(dynamic);
  assertPairs(interactive);
  assert.deepStrictEqual([...interactive.pairCounts], [...first.pairCounts]);
  assert.strictEqual(readImpactHistory(dynamic), interactive);
  assert.strictEqual(headChecks().length, 2, 'interactive inputs must still validate HEAD');

  fs.appendFileSync(path.join(root, 'input.js'), '// later\n');
  fs.writeFileSync(path.join(root, 'later.js'), '// later partner\n');
  git('add', '.');
  git('commit', '-qm', 'later pair');
  const later = git('rev-parse', 'HEAD');
  const changed = readImpactHistory(dynamic);
  assert.strictEqual(changed.pairCounts.get('input.js|later.js'), 1, 'interactive HEAD changes must invalidate history');
  assert(!readImpactHistory(fixed, parent).pairCounts.has('input.js|later.js'), 'fixed parent must not consume future history');
  assert.strictEqual(readImpactHistory(fixed, later).pairCounts.get('input.js|later.js'), 1, 'different declared revision must invalidate history');
  git('checkout', '-q', '--detach', parent);
  assert(!readImpactHistory(dynamic).pairCounts.has('input.js|later.js'), 'checkout to parent must remove future history');

  commands.length = 0;
  const degraded = { dataQuality: 'degraded', remediation: [{ code: 'fixture', action: 'inspect fixture' }] };
  const supplied = analyzeCoChanges(root, { revision: parent, gitEnvironment: degraded });
  assertPairs(supplied);
  assert.strictEqual(supplied.dataQuality, degraded.dataQuality);
  assert.deepStrictEqual(supplied.remediation, degraded.remediation);
  assert.strictEqual(envChecks().length, 0, 'supplied environment must avoid reprobe while retaining warnings');
  commands.length = 0;
  const unavailable = readImpactHistory(fixed, '0'.repeat(40));
  assert.strictEqual(unavailable.dataQuality, 'unavailable');
  assert.strictEqual(unavailable.pairCounts.size, 0);
  readImpactHistory(fixed, '0'.repeat(40));
  assert.strictEqual(logs().length, 2, 'unavailable history must never be cached');
  console.log('PASS: fixed-parent history, six-language pairs, dynamic HEAD invalidation and degraded environment');
} finally {
  cp.spawnSync = originalSpawn;
  cleanupTempDir(root);
}
