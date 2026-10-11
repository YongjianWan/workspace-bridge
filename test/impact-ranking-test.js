// @fast
// @semantic
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { dependencyGraph } = require('../src/tools/dep-tools');
const { normalizePathKey } = require('../src/utils/path');
const { curateImpact, readImpactHistory } = require('../src/tools/impact-ranking');
const { makeTempDir, cleanupTempDir, makeMockSnapshot } = require('./test-helpers');

async function main() {
  const root = makeTempDir('wb-impact-ranking-');
  const git = (...args) => {
    const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  const absolute = f => path.join(root, f);
  const input = 'UserService.js';
  const names = [input, 'Dep.js', 'UserDTO.js', 'UserEntity.js', 'Later.js'];
  const indexed = new Map(names.map(f => [normalizePathKey(absolute(f)), absolute(f)]));
  const graphRows = [{ file: absolute('Dep.js'), level: 1, reason: 'direct-import' }];
  const snapshot = makeMockSnapshot({ root, depGraphOverrides: {
    hasFile: f => indexed.has(normalizePathKey(f)),
    getAllFilePaths: () => [...indexed.keys()],
    _displayPath: f => indexed.get(normalizePathKey(f)) || f,
    getImpactRadius: () => graphRows,
    getSymbolImpact: () => ({ mode: 'file-fallback', impactedFiles: [] }),
  } });
  const container = { workspaceRoot: root, snapshot, ensureReady: async () => {} };
  const query = args => dependencyGraph({ operation: 'impact', file: input, ...args }, container);
  try {
    git('init', '-q');
    git('config', 'user.name', 'Fixture');
    git('config', 'user.email', 'fixture@example.com');
    for (const f of names.slice(0, 3)) fs.writeFileSync(absolute(f), 'export const value = 1;\n');
    git('add', '.'); git('commit', '-qm', 'initial');
    const parent = git('rev-parse', 'HEAD');
    fs.writeFileSync(absolute('UserEntity.js'), 'export const entity = 1;\n');
    const result = await query();
    assert.deepStrictEqual(result.impact.map(r => path.basename(r.file)), ['Dep.js', 'UserDTO.js', 'UserEntity.js'], 'all must interleave historical and same-stem candidates with graph rows');
    assert.deepStrictEqual(result.impact[0], graphRows[0], 'graph evidence must remain intact');
    assert.strictEqual(result.impact[1].source, 'cochange');
    assert.strictEqual(result.impact[1].coChangeCount, 1, 'one historical co-change is a candidate');
    assert.strictEqual(result.impact[2].source, 'same-stem');
    for (const row of result.impact.slice(1)) {
      assert.strictEqual(row.confidence, 'low');
      assert.strictEqual(row.dataQuality, 'certain');
      assert.strictEqual(Object.hasOwn(row, 'level'), false, 'heuristics have no graph distance');
    }
    assert.strictEqual(result.impactCount, 3);
    assert.strictEqual(result.graphImpactCount, 1);
    assert.strictEqual(result.truncated, false);
    const limited = await query({ maxFiles: 2 });
    assert.deepStrictEqual(limited.impact, result.impact.slice(0, 2));
    assert.strictEqual(limited.impactCount, 3);
    assert.strictEqual(limited.truncated, true);

    const duplicateRows = [graphRows[0], { file: absolute('UserDTO.js'), level: 2 }, { file: absolute('Later.js'), level: 3 }];
    const merged = curateImpact(container, absolute(input), duplicateRows);
    assert.deepStrictEqual(merged.map(row => path.basename(row.file)), ['Dep.js', 'UserDTO.js', 'UserEntity.js', 'Later.js'], 'duplicates consume a turn in the alternating order');
    assert.deepStrictEqual(merged[1], duplicateRows[1], 'a candidate reaching a graph file early must retain the complete graph evidence');
    for (const direction of ['dependents', 'dependencies', 'neighbors']) {
      assert.deepStrictEqual((await query({ direction })).impact, graphRows, 'explicit direction keeps graph semantics');
    }
    git('config', 'core.quotePath', 'true');
    for (const name of ['输入.js', '同伴.js']) {
      fs.writeFileSync(absolute(name), 'export const unicode = 1;\n');
      indexed.set(normalizePathKey(absolute(name)), absolute(name));
    }
    git('add', '输入.js', '同伴.js'); git('commit', '-qm', 'unicode pair');
    const unicode = await query({ file: '输入.js' });
    assert(unicode.impact.some(row => path.basename(row.file) === '同伴.js' && row.coChangeCount === 1), 'quoted Unicode git paths must match current index');
    fs.writeFileSync(absolute('Later.js'), 'export const later = 1;\n');
    fs.appendFileSync(absolute(input), '// changed\n');
    git('add', input, 'Later.js'); git('commit', '-qm', 'later pair');
    assert((await query()).impact.some(r => path.basename(r.file) === 'Later.js'));
    git('checkout', '-q', '--detach', parent);
    assert(!(await query()).impact.some(r => path.basename(r.file) === 'Later.js'), 'switching to P must drop future historical information');
    indexed.delete(normalizePathKey(absolute('UserDTO.js')));
    assert(!(await query()).impact.some(r => path.basename(r.file) === 'UserDTO.js'), 'historical candidates must still be indexed');
    indexed.delete(normalizePathKey(absolute(input)));
    graphRows.length = 0;
    assert.strictEqual((await query()).impact.length, 0, 'unknown targets must not gain heuristic evidence');
    indexed.set(normalizePathKey(absolute(input)), absolute(input));
    const nonGit = makeTempDir('wb-ranking-no-git-');
    try {
      const withoutGit = { ...container, workspaceRoot: nonGit, cache: { coChanges: { pairCounts: new Map([[`${input}|Later.js`, 99]]), dataQuality: 'certain' } } };
      const unavailable = readImpactHistory(withoutGit);
      assert.strictEqual(unavailable.dataQuality, 'unavailable');
      const rows = curateImpact(container, absolute(input), [], 'all', unavailable);
      assert(!rows.some(row => path.basename(row.file) === 'Later.js'), 'unstamped disk history must not be used when git is unavailable');
      assert(rows.some(row => path.basename(row.file) === 'UserEntity.js'), 'local same-stem evidence survives without git');
    } finally { cleanupTempDir(nonGit); }
    console.log('impact ranking contracts passed');
  } finally { cleanupTempDir(root); }
}
main().catch(e => { console.error(JSON.stringify({ message: e.message, actual: e.actual, expected: e.expected, stack: e.stack?.split('\n').slice(0, 3) })); process.exitCode = 1; });
