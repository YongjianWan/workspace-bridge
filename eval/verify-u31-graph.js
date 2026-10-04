// @semantic — Compare graph conclusions with includes read directly from a pinned repository.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const repo = path.join(__dirname, 'truth', 'repos', 'c-cpp', 'cJSON');
const expectedCommit = '6d9f2443ab071f86e5d9b43025a40929ec41c46c';
const cli = path.join(projectRoot, 'cli.js');
const samples = ['cJSON_Utils.h', 'cJSON.h', 'tests/common.h', 'cJSON_Utils.c'];
const slash = (value) => value.replaceAll('\\', '/');
const key = (value) => slash(value).toLowerCase();

function run(command, args, cwd = projectRoot) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')}: exit ${result.status}: ${result.error || result.stderr}`);
  }
  return result.stdout.trim();
}

function cliJson(command, cwd, extra = []) {
  return JSON.parse(run(process.execPath, [cli, command, '--cwd', cwd, ...extra, '--json', '--quiet']).replace(/^\uFEFF/, ''));
}

function cliJsonWithExit(command, cwd, extra = []) {
  const result = spawnSync(process.execPath, [cli, command, '--cwd', cwd, ...extra, '--json', '--quiet'],
    { cwd: projectRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw result.error;
  return { exitCode: result.status, output: JSON.parse(result.stdout.replace(/^\uFEFF/, '')) };
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '.git') return [];
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function includes(root) {
  const files = walk(root).filter((file) => /\.[ch]$/.test(file));
  const known = new Set(files.map((file) => key(path.relative(root, file))));
  const edges = new Set();
  for (const file of files) {
    const from = slash(path.relative(root, file));
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/^\s*#\s*include\s*"([^"\r\n]+)"/gm)) {
      const target = path.resolve(path.dirname(file), match[1]);
      const to = slash(path.relative(root, target));
      if (known.has(key(to))) edges.add(`${from}|${to}`);
    }
  }
  return { files, edges };
}

function reverseReachable(edges, target) {
  const reverse = new Map();
  for (const edge of edges) {
    const [from, to] = edge.split('|');
    if (!reverse.has(key(to))) reverse.set(key(to), new Set());
    reverse.get(key(to)).add(from);
  }
  const seen = new Set([key(target)]);
  const queue = [target];
  const found = [];
  while (queue.length) {
    for (const from of reverse.get(key(queue.shift())) || []) {
      if (seen.has(key(from))) continue;
      seen.add(key(from));
      found.push(from);
      queue.push(from);
    }
  }
  return found;
}

function relative(root, absolute) {
  return slash(path.relative(root, absolute));
}

const commit = run('git', ['rev-parse', 'HEAD'], repo);
if (commit !== expectedCommit) throw new Error(`cJSON commit changed: ${commit}`);
const truth = includes(repo);
const map = cliJson('audit-map', repo, ['--no-compact', '--max-files', '1000']);
const predicted = new Set(map.edges.filter((edge) => edge.type === 'import').map((edge) => `${edge.from}|${edge.to}`));
const missing = [...truth.edges].filter((edge) => !new Set([...predicted].map(key)).has(key(edge))).sort();
const extra = [...predicted].filter((edge) => !new Set([...truth.edges].map(key)).has(key(edge))).sort();
const impact = samples.map((sample) => {
  const expected = reverseReachable(truth.edges, sample).map(key).sort();
  const result = cliJson('impact', repo, ['--file', sample]);
  const actual = result.impact.map((entry) => key(relative(repo, entry.file))).sort();
  return { file: sample, expectedCount: expected.length, actualCount: actual.length,
    correct: JSON.stringify(expected) === JSON.stringify(actual) };
});
const direct = [...truth.edges].filter((edge) => key(edge.split('|')[1]) === key('cJSON_Utils.h'))
  .map((edge) => key(edge.split('|')[0])).sort();
const tree = cliJson('tree', repo, ['--file', 'cJSON_Utils.h', '--direction', 'dependents', '--max-depth', '1']);
const treeFiles = tree.tree.dependents.map((entry) => key(relative(repo, entry.file))).sort();
const guard = cliJsonWithExit('guard', repo,
  ['--file', 'cJSON_Utils.h', '--max-dependents', '3', '--max-transitive', '3']);
const cycles = cliJson('cycles', repo);
const graphChecks = {
  tree: { expectedCount: direct.length, actualCount: treeFiles.length,
    correct: JSON.stringify(direct) === JSON.stringify(treeFiles) },
  guard: { expectedDirect: direct.length,
    expectedTransitive: reverseReachable(truth.edges, 'cJSON_Utils.h').length,
    actualDirect: guard.output.stats.directDependentsCount,
    actualTransitive: guard.output.stats.transitiveDependentsCount,
    passed: guard.output.passed, exitCode: guard.exitCode },
  cycles: { expectedSccCount: 0, actualSccCount: cycles.sccCount },
};

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-u31-map-'));
if (path.dirname(path.resolve(fixture)) !== path.resolve(os.tmpdir())) {
    throw new Error(`refusing to remove unexpected fixture path: ${fixture}`);
  }
let caseFixture;
try {
  fs.writeFileSync(path.join(fixture, 'main.c'), '#include "A.h"\n');
  fs.writeFileSync(path.join(fixture, 'A.h'), '#pragma once\n');
  const upper = cliJson('audit-map', fixture, ['--no-compact']);
  const upperImpact = cliJson('impact', fixture, ['--file', 'A.h']);
  fs.writeFileSync(path.join(fixture, 'A.h'), '#include "main.c"\n');
  const addedCycle = cliJson('cycles', fixture);
  fs.renameSync(path.join(fixture, 'A.h'), path.join(fixture, 'a.h'));
  fs.writeFileSync(path.join(fixture, 'a.h'), '#pragma once\n');
  fs.writeFileSync(path.join(fixture, 'main.c'), '#include "a.h"\n');
  const lower = cliJson('audit-map', fixture, ['--no-compact']);
  caseFixture = { upper: { edges: upper.edges, ok: upper.ok, warnings: upper.warnings.length,
    impactCount: upperImpact.impactCount }, addedCycle: { sccCount: addedCycle.sccCount,
    cycles: addedCycle.cycles }, lower: { edges: lower.edges, ok: lower.ok } };
} finally {

  fs.rmSync(fixture, { recursive: true, force: true });
}

const report = { repo: 'cJSON', commit, files: truth.files.length, truthEdges: truth.edges.size,
  mapEdges: predicted.size, missingCount: missing.length, missing, extraCount: extra.length, extra,
  impact, graphChecks, caseFixture };
const out = path.join(__dirname, 'truth', 'out', 'c-cpp', 'cJSON', 'u31-graph.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ out, files: report.files, truthEdges: report.truthEdges,
  mapEdges: report.mapEdges, missingCount: report.missingCount, extraCount: report.extraCount,
  impact, graphChecks, caseFixture }));
