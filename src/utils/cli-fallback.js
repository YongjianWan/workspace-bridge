const path = require('path');
const { spawnSync } = require('child_process');

function isMissingCommand(result) {
  if (!result) return true;
  if (result.error && result.error.code === 'ENOENT') return true;
  if (result.status === 127 || result.status === 9009) return true;
  return false;
}

function runCommand(command, args, options = {}) {
  return spawnSync(command, args, {
    stdio: options.stdio || 'inherit',
    cwd: options.cwd || process.cwd(),
    env: options.env || process.env,
    shell: false,
  });
}

function runCliWithFallback(args, options = {}) {
  const globalCmd = options.globalCmd || process.env.WB_GLOBAL_CLI || 'workspace-bridge-cli';
  const localCliPath = options.localCliPath || path.resolve(__dirname, '..', '..', 'cli.js');
  const nodeCmd = options.nodeCmd || process.execPath;
  const forceLocal = options.forceLocal || process.env.WB_FORCE_LOCAL === '1';

  if (forceLocal) {
    const local = runCommand(nodeCmd, [localCliPath, ...args], options);
    return { used: 'local', result: local };
  }

  const primary = runCommand(globalCmd, args, options);
  if (!isMissingCommand(primary)) {
    return { used: 'global', result: primary };
  }

  const local = runCommand(nodeCmd, [localCliPath, ...args], options);
  return { used: 'local', result: local, fallbackFrom: globalCmd };
}

module.exports = {
  isMissingCommand,
  runCliWithFallback,
};

