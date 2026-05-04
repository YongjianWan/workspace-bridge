/**
 * Command execution utilities - SECURE VERSION
 * All commands use spawn with parameter arrays to prevent injection
 */
const cp = require('child_process');
const path = require('path');
const { TIMEOUTS, LIMITS } = require('../config/constants');

function resolveCommandForPlatform(command) {
  if (process.platform !== 'win32') return command;
  if (typeof command !== 'string' || !command) return command;
  if (path.extname(command)) return command;
  const lower = command.toLowerCase();
  // npm/npx ship as .cmd on Windows; semgrep/codeql may be .exe.
  // Only force .cmd for npm/npx — for others let spawn search PATHEXT.
  if (['npm', 'npx'].includes(lower)) {
    return `${command}.cmd`;
  }
  return command;
}

/**
 * Securely run a command with argument array (NO shell injection possible)
 * @param {string} command - Base command
 * @param {string[]} args - Arguments array (each element is safely passed)
 * @param {string} cwd - Working directory
 * @param {number} timeoutMs - Timeout in ms
 * @returns {Promise<{ok: boolean, command: string, exitCode: number, stdout: string, stderr: string}>}
 */
function runCommandSecure(command, args, cwd, timeoutMs = TIMEOUTS.COMMAND_DEFAULT_MS) {
  return new Promise((resolve) => {
    const resolvedCommand = resolveCommandForPlatform(command);
    const useWindowsCmdShim = process.platform === 'win32' && /\.cmd$/i.test(resolvedCommand);
    const spawnCommand = useWindowsCmdShim ? 'cmd.exe' : resolvedCommand;
    const spawnArgs = useWindowsCmdShim
      ? ['/d', '/s', '/c', resolvedCommand, ...args]
      : args;

    const child = cp.spawn(spawnCommand, spawnArgs, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: timeoutMs,
    });

    let stdout = '';
    let stderr = '';
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout.on('data', (data) => {
      stdout += data.toString('utf8');
      // Prevent memory exhaustion from huge output
      if (stdout.length > LIMITS.COMMAND_OUTPUT_MAX_BYTES) {
        stdout = stdout.slice(0, LIMITS.COMMAND_OUTPUT_MAX_BYTES) + '\n...[truncated due to size limit]';
        child.stdout.destroy();
        child.kill('SIGTERM');
      }
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString('utf8');
      if (stderr.length > LIMITS.COMMAND_OUTPUT_MAX_BYTES) {
        stderr = stderr.slice(0, LIMITS.COMMAND_OUTPUT_MAX_BYTES) + '\n...[truncated due to size limit]';
        child.stderr.destroy();
        child.kill('SIGTERM');
      }
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const exitCode = killed ? 124 : (code !== null ? code : 1);
      resolve({
        ok: exitCode === 0,
        command: `${spawnCommand} ${spawnArgs.join(' ')}`,
        exitCode,
        stdout: stdout || '',
        stderr: stderr || '',
        timedOut: killed,
        signal,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        command: `${spawnCommand} ${spawnArgs.join(' ')}`,
        exitCode: 1,
        stdout: stdout || '',
        stderr: stderr || String(err.message || err),
        error: err,
      });
    });
  });
}

/**
 * Run git command securely with argument array
 * @param {string[]} args - Git arguments array
 * @param {string} cwd - Working directory
 * @param {number} timeoutMs - Timeout
 * @returns {Promise<{ok: boolean, command: string, exitCode: number, stdout: string, stderr: string}>}
 */
function runGit(args, cwd, timeoutMs = TIMEOUTS.GIT_DEFAULT_MS) {
  // Always disable quote path for consistent UTF-8 handling
  const gitArgs = ['-c', 'core.quotepath=off', ...args];
  return runCommandSecure('git', gitArgs, cwd, timeoutMs);
}

/**
 * Run Python module securely
 * @param {string} python - Python executable path
 * @param {string} module - Module name
 * @param {string[]} args - Arguments
 * @param {string} cwd - Working directory
 * @param {number} timeoutMs - Timeout
 * @returns {Promise<{ok: boolean, command: string, exitCode: number, stdout: string, stderr: string}>}
 */
function runPythonModule(python, module, args, cwd, timeoutMs = TIMEOUTS.PYTHON_MODULE_DEFAULT_MS) {
  const allArgs = ['-m', module, ...args];
  return runCommandSecure(python, allArgs, cwd, timeoutMs);
}

/**
 * Run npx command securely
 * @param {string} pkg - Package name
 * @param {string[]} args - Arguments
 * @param {string} cwd - Working directory
 * @param {number} timeoutMs - Timeout
 * @returns {Promise<{ok: boolean, command: string, exitCode: number, stdout: string, stderr: string}>}
 */
function runNpx(pkg, args, cwd, timeoutMs = TIMEOUTS.NPX_DEFAULT_MS) {
  const allArgs = [pkg, ...args];
  return runCommandSecure('npx', allArgs, cwd, timeoutMs);
}

/**
 * Check if a command exists
 * @param {string} command - Command to check
 * @param {string} cwd - Working directory
 * @returns {Promise<boolean>}
 */
async function commandExists(command, cwd) {
  const isWindows = process.platform === 'win32';
  const checkCmd = isWindows ? 'where' : 'which';
  // Resolve through the same platform mapping spawn uses, so availability
  // and execution agree on which file to look for (codeql.cmd vs codeql.exe).
  const resolved = resolveCommandForPlatform(command);
  const result = await runCommandSecure(checkCmd, [resolved], cwd, TIMEOUTS.COMMAND_EXISTS_CHECK_MS);
  return result.ok && result.stdout.trim().length > 0;
}

function trimOutput(value, limit = LIMITS.TRIM_OUTPUT_DEFAULT_CHARS) {
  if (!value) return '';
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n...<truncated>`;
}

module.exports = {
  // Secure methods (RECOMMENDED)
  runCommandSecure,
  runGit,
  runPythonModule,
  runNpx,
  commandExists,
  trimOutput,
};
