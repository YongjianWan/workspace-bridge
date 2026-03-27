/**
 * Command execution utilities
 */
const cp = require('child_process');

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

function runCommandAsync(command, cwd, timeoutMs = 120000) {
  return new Promise((resolve) => {
    cp.exec(command, {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024 * 4,
    }, (error, stdout, stderr) => {
      if (error) {
        resolve({
          ok: false,
          command,
          exitCode: typeof error.code === 'number' ? error.code : 1,
          stdout: stdout || '',
          stderr: stderr || String(error.message || error),
        });
      } else {
        resolve({ ok: true, command, exitCode: 0, stdout: stdout || '', stderr: '' });
      }
    });
  });
}

// Wraps git with -c core.quotepath=off so non-ASCII paths are returned as UTF-8
function runGit(args, cwd, timeoutMs = 30000) {
  return runCommand(`git -c core.quotepath=off ${args}`, cwd, timeoutMs);
}

function trimOutput(value, limit = 12000) {
  if (!value) return '';
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n...<truncated>`;
}

module.exports = {
  runCommand,
  runCommandAsync,
  runGit,
  trimOutput,
};
