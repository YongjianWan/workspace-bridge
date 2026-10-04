// @semantic
// @slow
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { runCliInProcessRaw, makeTempDir, cleanupTempDir } = require('./test-helpers');

async function main() {
  const root = makeTempDir('wb-save-cli-');
  const outside = makeTempDir('wb-save-cli-outside-');
  try {
    fs.writeFileSync(path.join(root, 'app.js'), 'exports.value = 1;');
    const victim = path.join(outside, 'keep.json');
    const original = '{"keep":true}';
    fs.writeFileSync(victim, original);
    for (const command of ['audit-summary', 'audit-overview']) {
      const rejected = await runCliInProcessRaw([command, '--cwd', root, '--save', victim, '--json', '--quiet']);
      assert.strictEqual(rejected.status, 2, `${command} must reject outside target`);
      assert.strictEqual(JSON.parse(rejected.stdout).ok, false);
      assert.strictEqual(fs.readFileSync(victim, 'utf8'), original);
      const target = path.join(root, `${command}.json`);
      for (let attempt = 0; attempt < 2; attempt++) {
        const accepted = await runCliInProcessRaw([command, '--cwd', root, '--save', target, '--json', '--quiet']);
        assert.strictEqual(accepted.status, 0, accepted.stderr || accepted.stdout);
        assert.strictEqual(JSON.parse(accepted.stdout).baselineSaved, target);
        assert(Array.isArray(JSON.parse(fs.readFileSync(target, 'utf8')).findings.cycles));
      }
      console.log(`OK ${command} rejects outside saves and updates its own baseline`);
    }
  } finally {
    cleanupTempDir(root);
    cleanupTempDir(outside);
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
