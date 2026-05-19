const { validateCwd } = require('./_utils');

async function watchCmd(parsed, _container) {
  const invalidWatch = validateCwd(parsed);
  if (invalidWatch) return { ...invalidWatch, __managedLifecycle: true };
  const { startWatch } = require('../../cli/watch');
  await startWatch({ cwd: parsed.cwd, exclude: parsed.exclude, compact: parsed.compact, runTests: parsed.runTests });
  return { ok: true, __managedLifecycle: true };
}

module.exports = watchCmd;
