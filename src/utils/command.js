/**
 * Command execution utilities - SECURE VERSION
 * All commands use spawn with parameter arrays to prevent injection
 */
const cp = require('child_process');
const path = require('path');

/**
 * Securely run a command with argument array (NO shell injection possible)
 * @param {string} command - Base command
 * @param {string[]} args - Arguments array (each element is safely passed)
 * @param {string} cwd - Working directory
 * @param {number} timeoutMs - Timeout in ms
 * @returns {Promise<{ok: boolean, command: string, exitCode: number, stdout: string, stderr: string}>}
 */
function runCommandSecure(command, args, cwd, timeoutMs = 120000) {
  return new Promise((resolve) => {
    const child = cp.spawn(command, args, {
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
      if (stdout.length > 10 * 1024 * 1024) {
        stdout = stdout.slice(0, 10 * 1024 * 1024) + '\n...[truncated due to size limit]';
        child.stdout.destroy();
      }
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString('utf8');
      if (stderr.length > 10 * 1024 * 1024) {
        stderr = stderr.slice(0, 10 * 1024 * 1024) + '\n...[truncated due to size limit]';
        child.stderr.destroy();
      }
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const exitCode = killed ? 124 : (code !== null ? code : 1);
      resolve({
        ok: exitCode === 0,
        command: `${command} ${args.join(' ')}`,
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
        command: `${command} ${args.join(' ')}`,
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
function runGit(args, cwd, timeoutMs = 30000) {
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
function runPythonModule(python, module, args, cwd, timeoutMs = 30000) {
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
function runNpx(pkg, args, cwd, timeoutMs = 30000) {
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
  const result = await runCommandSecure(checkCmd, [command], cwd, 5000);
  return result.ok && result.stdout.trim().length > 0;
}

/**
 * DEPRECATED: Legacy command execution (kept for backwards compatibility)
 * WARNING: Do not use for user-input commands - use runCommandSecure instead
 */
function runCommand(command, cwd, timeoutMs = 120000) {
  try {
    const stdout = cp.execSync(command, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024 * 4,
    });

    return {
      ok: true,
      command,
      exitCode: 0,
      stdout: stdout || '',
      stderr: '',
    };
  } catch (error) {
    return {
      ok: false,
      command,
      exitCode: typeof error.status === 'number' ? error.status : 1,
      stdout: error.stdout ? String(error.stdout) : '',
      stderr: error.stderr ? String(error.stderr) : String(error.message || error),
    };
  }
}

function trimOutput(value, limit = 12000) {
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
  
  // Legacy methods (DEPRECATED - for internal use only)
  runCommand,
  trimOutput,
};
