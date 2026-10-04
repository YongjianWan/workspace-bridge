// @semantic — Actual API cleanup rejection and incremental CLI gate fault injection.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ServiceContainer } = require('../src/services/container');
const { runApiContracts } = require('../src/tools/api-contract-tools');
const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-lifecycle-gates-'));
const report = {};
function command(program, args, cwd) {
  const run = spawnSync(program, args, { cwd, encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, WB_CACHE_DIR: path.join(scratch, 'gate-cache') } });
  if (run.error) throw run.error;
  return run;
}
(async () => {
  const frontend = path.join(scratch, 'frontend');
  const backend = path.join(scratch, 'backend');
  for (const dir of [frontend, backend]) { fs.mkdirSync(dir); fs.writeFileSync(path.join(dir, 'main.js'), 'module.exports = 1;\n'); }
  const initialize = ServiceContainer.prototype.initialize;
  const shutdown = ServiceContainer.prototype.shutdown;
  const initialized = [];
  const calls = [];
  ServiceContainer.prototype.initialize = async function (...args) {
    const result = await initialize.apply(this, args);
    initialized.push(this);
    return result;
  };
  ServiceContainer.prototype.shutdown = async function () { calls.push(this.workspaceRoot); throw new Error('Injected frontend shutdown rejection'); };
  try { await runApiContracts({ frontend, backend, cacheDir: path.join(scratch, 'api-cache') }); }
  catch (error) { report.apiCleanup = { initialized: initialized.map((container) => container.workspaceRoot), shutdownCalls: calls, error: error.message, scope: 'Actual orchestrator with injected first cleanup failure; final fixture cleanup performed separately' }; }
  finally {
    ServiceContainer.prototype.initialize = initialize;
    ServiceContainer.prototype.shutdown = shutdown;
    for (const container of initialized) await shutdown.call(container);
  }
  const dir = path.join(scratch, 'gate');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'a.js'), "module.exports = require('./b');\n");
  fs.writeFileSync(path.join(dir, 'b.js'), 'module.exports = 1;\n');
  for (const args of [['init', '-b', 'main'], ['config', 'user.name', 'Fixture'], ['config', 'user.email', 'fixture@example.invalid'], ['add', '.'], ['commit', '-qm', 'initial']]) {
    const run = command('git', args, dir);
    if (run.status !== 0) throw new Error(run.stderr);
  }
  command(process.execPath, [path.join(root, 'cli.js'), 'audit-overview', '--cwd', dir, '--json', '--quiet'], dir);
  fs.writeFileSync(path.join(dir, 'b.js'), "module.exports = require('./a');\n");
  const gate = command(process.execPath, [path.join(root, 'cli.js'), 'audit-diff', '--cwd', dir, '--incremental', '--fail-on-findings', '--json', '--quiet'], dir);
  const cycles = command(process.execPath, [path.join(root, 'cli.js'), 'cycles', '--cwd', dir, '--json', '--quiet'], dir);
  report.incrementalGate = { expectedNewCycles: 1, exitCode: gate.status, data: JSON.parse(gate.stdout.replace(/^\uFEFF/, '')), coldCycles: JSON.parse(cycles.stdout.replace(/^\uFEFF/, '')) };
  fs.writeFileSync(path.join(__dirname, 'truth/lifecycle-gates.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ apiCleanup: report.apiCleanup, gateExit: gate.status, hasFindings: report.incrementalGate.data.hasFindings, findings: report.incrementalGate.data.incrementalFindings, coldCycles: report.incrementalGate.coldCycles }));
})().catch((error) => { console.error(error); process.exitCode = 1; });
