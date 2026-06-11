const { validateCwd } = require('./_utils');

async function replCmd(parsed, _container) {
  const invalidRepl = validateCwd(parsed);
  if (invalidRepl) return { ...invalidRepl, __managedLifecycle: true };
  const { startRepl } = require('../../cli/repl');
  await startRepl({ cwd: parsed.cwd, exclude: parsed.exclude, quiet: parsed.quiet, eval: parsed.eval, json: parsed.json, cacheDir: parsed.cacheDir });
  return { ok: true, __managedLifecycle: true };
}

module.exports = replCmd;
