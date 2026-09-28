#!/usr/bin/env node
// @semantic @slow — coverage scorer must query the current graph without a persisted impact table.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadPredictions } = require('../eval/score');

function write(root, file, content) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-eval-score-'));
  const repo = path.join(tmp, 'repo');
  const cache = path.join(tmp, 'cache');
  try {
    write(repo, 'requirements.txt', 'requests\n');
    write(repo, 'pkg/__init__.py', '');
    write(repo, 'pkg/helper.py', 'value = 1\n');
    write(repo, 'pkg/a.py', 'from pkg import helper\n\ndef run():\n    return helper.value\n');
    write(repo, 'pkg/test_a.py', 'from pkg.a import run\n\ndef test_run():\n    assert run()\n');

    for (const run of ['cold', 'warm']) {
      const predictions = await loadPredictions(repo, cache, ['pkg/helper.py']);
      const files = [...predictions.get('pkg/helper.py')].sort();
      assert.deepStrictEqual(files, ['pkg/test_a.py'], `${run} coverage predictions must include the dependent test`);
    }
    console.log('eval-score-coverage-test: PASS');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
