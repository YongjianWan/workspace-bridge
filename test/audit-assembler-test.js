#!/usr/bin/env node
// @semantic
// @slow

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { runInDir, makeTempDir, cleanupTempDir, REPO_ROOT, CLI_PATH } = require('./test-helpers');
const { ServiceContainer } = require('../src/services/container');
const { formatAi } = require('../src/cli/formatters/human-formatters');
const {
  assembleSummary,
  assembleDiff,
  assembleFile,
  assembleSecurity
} = require('../src/tools/audit-assembler');

function commitAll(tempRoot, message) {
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Test User',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test User',
    GIT_COMMITTER_EMAIL: 'test@example.com',
  };
  const result = spawnSync('git', ['commit', '-m', message], {
    cwd: tempRoot,
    encoding: 'utf8',
    env,
  });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
}

async function runTests() {
  console.log('Starting audit-assembler-test.js...');
  const tempRoot = makeTempDir('workspace-bridge-assembler-');
  let container;
  try {

  function writeFile(relativePath, content) {
    const fullPath = path.join(tempRoot, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }

  // Set up mock repository structure
  writeFile('package.json', JSON.stringify({
    name: 'assembler-fixture',
    version: '1.0.0',
    main: 'src/index.js',
    scripts: {
      test: 'node test/index.test.js',
    },
  }, null, 2));

  writeFile('src/index.js', `
    const { helper } = require('./helper');
    function main() {
      return helper();
    }
    module.exports = { main };
  `);

  writeFile('src/helper.js', `
    function helper() {
      return 'ok';
    }
    function deadExport() {
      return 'unused';
    }
    module.exports = { helper, deadExport };
  `);

  writeFile('test/index.test.js', `
    const { main } = require('../src/index');
    console.log(main());
  `);

  // Initialize Git
  runInDir('git', ['init'], tempRoot);
  runInDir('git', ['config', 'user.email', 'test@example.com'], tempRoot);
  runInDir('git', ['config', 'user.name', 'Test User'], tempRoot);
  runInDir('git', ['add', '.'], tempRoot);
  commitAll(tempRoot, 'Initial commit');

  // Initialize container
  container = new ServiceContainer({ quiet: true });
  await container.initialize(tempRoot);

  // 1. Test assembleSummary
  console.log('Testing assembleSummary...');
  const summaryResult = await assembleSummary({ cwd: tempRoot }, container);
  assert.strictEqual(summaryResult.ok, true, 'assembleSummary should be ok');
  assert.strictEqual(summaryResult.workspaceRoot, container.workspaceRoot);
  assert(summaryResult.summary, 'should build summary string');
  assert.strictEqual(typeof summaryResult.hasFindings, 'boolean');
  assert.strictEqual(summaryResult.hasFindings, summaryResult.deadExports.deadExportsCount > 0);

  // 2. Test assembleDiff
  console.log('Testing assembleDiff...');
  // Modify src/helper.js to trigger a diff
  writeFile('src/helper.js', `
    function helper() {
      return 'v2';
    }
    function deadExport() {
      return 'still unused';
    }
    module.exports = { helper, deadExport };
  `);

  const diffResult = await assembleDiff({ cwd: tempRoot, staged: false }, container);
  assert.strictEqual(diffResult.ok, true, 'assembleDiff should be ok');
  assert.strictEqual(diffResult.changedFiles.length, 1);
  assert.strictEqual(diffResult.changedFiles[0].file.replace(/\\/g, '/'), 'src/helper.js');
  assert.strictEqual(typeof diffResult.hasFindings, 'boolean');

  // 3. Test assembleFile
  console.log('Testing assembleFile...');
  const fileResult = await assembleFile({ cwd: tempRoot, file: 'src/helper.js' }, container);
  assert.strictEqual(fileResult.ok, true, 'assembleFile should be ok');
  assert.strictEqual(fileResult.file, 'src/helper.js');
  assert.strictEqual(typeof fileResult.hasFindings, 'boolean');
  assert(fileResult.impact.impactCount >= 0);
  assert(fileResult.affectedTests.affectedTestsCount >= 0);

  // 4. Test assembleSecurity
  console.log('Testing assembleSecurity...');
  const secResult = await assembleSecurity({ cwd: tempRoot }, container);
  assert.strictEqual(secResult.ok, true, 'assembleSecurity should be ok');
  assert.strictEqual(typeof secResult.hasFindings, 'boolean');

  // 5. Test formatAi on audit-file
  console.log('Testing formatAi for audit-file...');
  const aiOutputFull = formatAi('audit-file', fileResult, { depth: 'full' });
  const parsedAiFull = JSON.parse(aiOutputFull);
  assert.strictEqual(parsedAiFull.ok, true);
  assert.strictEqual(parsedAiFull.command, 'audit-file');
  assert(parsedAiFull.details, 'details should exist for depth: full');
  assert(Array.isArray(parsedAiFull.details.impact));
  assert(Array.isArray(parsedAiFull.details.affectedTests));

  const aiOutputSurface = formatAi('audit-file', fileResult, { depth: 'surface' });
  const parsedAiSurface = JSON.parse(aiOutputSurface);
  assert.strictEqual(parsedAiSurface.ok, true);
  assert.strictEqual(parsedAiSurface.command, 'audit-file');
  assert.strictEqual(parsedAiSurface.details, undefined, 'details should not exist for depth: surface');

  console.log('All assembler tests passed successfully!');
  } finally {
    if (container) {
      await container.shutdown();
    }
    cleanupTempDir(tempRoot);
  }
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
