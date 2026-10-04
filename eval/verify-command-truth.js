// @semantic — Hand-labelled conclusions from fixed real repositories.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const corpus = require('./corpus.json').repos;
const normalized = (value) => value.replaceAll('\\', '/').toLowerCase();
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-command-truth-'));
if (path.dirname(path.resolve(scratch)) !== path.resolve(os.tmpdir())) throw new Error('Unsafe scratch path');

function pinned(name, lang) {
  const repo = path.join(__dirname, 'truth', 'repos', lang, name);
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' });
  const commit = result.stdout.trim();
  if (result.status !== 0 || !commit.startsWith(corpus.find((item) => item.name === name).commit)) {
    throw new Error(`Wrong corpus checkout: ${name} ${commit}`);
  }
  return { repo, commit };
}

function cli(command, cwd, args = []) {
  const result = spawnSync(process.execPath, [path.join(root, 'cli.js'), command,
    '--cwd', cwd, ...args, '--json', '--quiet'], {
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 120000,
    env: { ...process.env, WB_CACHE_DIR: path.join(scratch, 'cache') },
  });
  if (result.error) throw result.error;
  const data = JSON.parse(result.stdout.replace(/^\uFEFF/, ''));
  if (!data.ok) throw new Error(`${command}: ${JSON.stringify(data)}`);
  return { exitCode: result.status, data };
}

try {
  const java = pinned('spring-petclinic', 'java');
  const prefix = 'src/main/java/org/springframework/samples/petclinic/';
  // Independently labelled from controller fields/constructors and @Controller.
  const routeLabels = [
    { file: `${prefix}owner/OwnerRepository.java`, expected: ['owner/OwnerController.java',
      'owner/PetController.java', 'owner/VisitController.java'] },
    { file: `${prefix}vet/VetRepository.java`, expected: ['vet/VetController.java'] },
  ];
  const routes = routeLabels.map(({ file, expected }) => {
    const { data } = cli('affected-routes', java.repo, ['--file', file]);
    const actual = data.routes.map((item) => normalized(path.relative(java.repo, item.entry))).sort();
    const truth = expected.map((item) => normalized(prefix + item)).sort();
    return { file, expected: truth, actual, routesCount: data.routesCount,
      correct: JSON.stringify(truth) === JSON.stringify(actual) && actual.length === data.routesCount };
  });

  const c = pinned('cJSON', 'c-cpp');
  const copied = path.join(scratch, 'cJSON');
  fs.cpSync(c.repo, copied, { recursive: true, filter: (source) => path.basename(source) !== '.git' });
  fs.writeFileSync(path.join(copied, '.workspace-bridge.json'), JSON.stringify({
    boundaries: [{ from: 'cJSON_Utils.c', deny: ['cJSON_Utils.h'] }],
  }));
  // Hand-labelled local include edge.
  const boundaryOutput = cli('audit-overview', copied, ['--category', 'boundaries']).data;
  const actualEdges = boundaryOutput.boundaries.violations.map((item) =>
    normalized(`${item.sourceFile}|${item.targetFile}`)).sort();
  const expectedEdges = ['cjson_utils.c|cjson_utils.h'];
  const boundaries = { expected: expectedEdges, actual: actualEdges,
    count: boundaryOutput.boundaries.violationsCount,
    correct: JSON.stringify(expectedEdges) === JSON.stringify(actualEdges)
      && boundaryOutput.boundaries.violationsCount === expectedEdges.length };

  const smellOutput = cli('audit-overview', c.repo, ['--category', 'smells']).data;
  // Counts come from source control constructs, not the production parser's records.
  // Minify: 7 switch labels, 3 if + 1 while + 1 switch => CC 6.
  // Float/Double: 9 labels, 3 if + 1 switch + 3 logical + 1 ternary => CC 9.
  // Options: 7 labels, 5 if + 1 for + 1 switch => CC 8.
  const smellLabels = [
    { name: 'cJSON_Minify', file: 'cJSON.c', arms: 7, complexity: 6 },
    { name: 'UnityAssertFloatSpecial', file: 'tests/unity/src/unity.c', arms: 9, complexity: 9 },
    { name: 'UnityAssertDoubleSpecial', file: 'tests/unity/src/unity.c', arms: 9, complexity: 9 },
    { name: 'UnityParseOptions', file: 'tests/unity/src/unity.c', arms: 7, complexity: 8 },
    { name: 'cJSON_IsNumber', file: 'cJSON.c', absent: true },
    { name: 'cJSON_IsNull', file: 'cJSON.c', absent: true },
  ];
  const smells = smellLabels.map((label) => {
    const found = smellOutput.smells.smells.find((item) => item.functionName === label.name
      && normalized(item.file) === normalized(label.file));
    return { label, actual: found || null, correct: label.absent ? !found
      : Boolean(found && found.arms === label.arms && found.complexity === label.complexity) };
  });
  const report = { javaCommit: java.commit, cCommit: c.commit, routes, boundaries, smells,
    smellCountMatchesList: smellOutput.smells.smellsCount === smellOutput.smells.smells.length,
    scope: 'Two controller-entry sets, one explicit boundary edge, six manually labelled functions; no global accuracy claim.' };
  const out = path.join(__dirname, 'truth', 'command-truth.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ routes: routes.map((item) => ({ file: item.file,
    expected: item.expected.length, actual: item.actual.length, correct: item.correct })),
    boundaries, smells: smells.map((item) => ({ name: item.label.name, correct: item.correct })), out }));
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
