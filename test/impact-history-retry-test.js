// @fast
// @semantic
const assert = require('assert');
const childProcess = require('child_process');
const original = childProcess.spawnSync;
let logCalls = 0;
try {
  childProcess.spawnSync = (_command, args) => {
    if (args.includes('--is-inside-work-tree')) return { status: 0, stdout: 'true\n' };
    if (args.includes('HEAD')) return { status: 0, stdout: 'a'.repeat(40) + '\n' };
    if (args.includes('log')) {
      logCalls++;
      return logCalls === 1 ? { status: null, error: new Error('timeout') }
        : { status: 0, stdout: 'a'.repeat(40) + '\0\nUserService.js\0UserDTO.js\0' };
    }
    return { status: 1, stdout: '' };
  };
  const { readImpactHistory } = require('../src/tools/impact-ranking');
  const container = { workspaceRoot: '/fixture' };
  assert.strictEqual(readImpactHistory(container).dataQuality, 'unavailable');
  const recovered = readImpactHistory(container);
  assert.strictEqual(recovered.pairCounts.get('UserDTO.js|UserService.js'), 1, 'same HEAD must retry after a transient log failure');
  assert.strictEqual(logCalls, 2);
  assert.strictEqual(readImpactHistory(container), recovered, 'successful history is reused');
  assert.strictEqual(logCalls, 2);
  console.log('impact history recovery passed');
} finally { childProcess.spawnSync = original; }
