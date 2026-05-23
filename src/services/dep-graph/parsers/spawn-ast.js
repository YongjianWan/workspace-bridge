const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { TIMEOUTS, LIMITS } = require('../../../config/constants');

// Module-level semaphore to bound Python sub-process memory.
// Each Python process uses 30-80MB; on large Java/Python repos,
// unbounded concurrency can spike to 600MB-1.6GB.
let activeParsers = 0;
const parserQueue = [];

function acquireParserSlot() {
  if (activeParsers < LIMITS.PYTHON_AST_CONCURRENCY) {
    activeParsers++;
    return Promise.resolve();
  }
  return new Promise((resolve) => parserQueue.push(resolve));
}

function releaseParserSlot() {
  activeParsers--;
  const next = parserQueue.shift();
  if (next) {
    activeParsers++;
    next();
  }
}

async function spawnPythonASTParser(scriptName, content, timeoutMs = TIMEOUTS.PYTHON_AST_PARSE_MS) {
  await acquireParserSlot();
  try {
    return await _spawnPythonASTParser(scriptName, content, timeoutMs);
  } finally {
    releaseParserSlot();
  }
}

function _spawnPythonASTParser(scriptName, content, timeoutMs) {
  return new Promise((resolve) => {
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    const scriptPath = path.join(__dirname, '..', '..', '..', '..', 'scripts', scriptName);

    if (!fs.existsSync(scriptPath)) {
      resolve(null);
      return;
    }

    const python = spawn(pythonCmd, [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });

    // Do not let a hung Python parser keep the Node event loop alive.
    if (typeof python.unref === 'function') {
      python.unref();
    }

    let output = '';
    let errorOutput = '';
    let killed = false;

    const termTimer = setTimeout(() => {
      killed = true;
      python.kill('SIGTERM');
    }, timeoutMs);

    const killTimer = setTimeout(() => {
      try {
        python.kill('SIGKILL');
      } catch (_) {
        // Already exited or permission denied
      }
    }, timeoutMs + TIMEOUTS.PYTHON_AST_SIGKILL_DELAY_MS);

    python.stdout.on('data', (data) => {
      output += data.toString('utf8');
      if (output.length > LIMITS.COMMAND_OUTPUT_MAX_BYTES) {
        output = output.slice(0, LIMITS.COMMAND_OUTPUT_MAX_BYTES) + '\n...[truncated]';
        python.stdout.destroy();
        python.kill('SIGTERM');
      }
    });

    python.stderr.on('data', (data) => {
      errorOutput += data.toString('utf8');
      if (errorOutput.length > LIMITS.COMMAND_OUTPUT_MAX_BYTES) {
        errorOutput = errorOutput.slice(0, LIMITS.COMMAND_OUTPUT_MAX_BYTES) + '\n...[truncated]';
        python.stderr.destroy();
        python.kill('SIGTERM');
      }
    });

    python.on('close', (code) => {
      clearTimeout(termTimer);
      clearTimeout(killTimer);
      if (killed || code !== 0) {
        if (process.env.DEBUG) {
          console.error(`[DepGraph] ${scriptName} parse failed: exitCode=${code}, stderr=${errorOutput}`);
        }
        // Detect Windows Store Python pipe failure (exit code 49)
        if (code === 49 && process.platform === 'win32') {
          console.error(
            `[workspace-bridge] Python AST parser exited with code 49. ` +
            `This is a known issue with Windows Store Python in Git Bash when piping large data. ` +
            `Suggested workarounds: 1) Use system Python instead of Windows Store Python, ` +
            `2) Run in PowerShell, or 3) Set PYTHONIOENCODING=utf-8`
          );
        }
        resolve(null);
        return;
      }
      try {
        let cleanOutput = output;
        if (cleanOutput.startsWith('\ufeff')) {
          cleanOutput = cleanOutput.slice(1);
        }
        const result = JSON.parse(cleanOutput);
        resolve(result);
      } catch (e) {
        if (process.env.DEBUG) {
          console.error(`[DepGraph] ${scriptName} JSON parse failed: ${e.message}`);
        }
        resolve(null);
      }
    });

    python.on('error', (err) => {
      clearTimeout(termTimer);
      clearTimeout(killTimer);
      if (process.env.DEBUG) {
        console.error(`[DepGraph] ${scriptName} spawn failed: ${err.message}`);
      }
      resolve(null);
    });

    python.stdin.on('error', (err) => {
      if (process.env.DEBUG) {
        console.error(`[DepGraph] ${scriptName} stdin error: ${err.message}`);
      }
    });

    try {
      python.stdin.write(content, 'utf8');
      python.stdin.end();
    } catch (err) {
      if (process.env.DEBUG) {
        console.error(`[DepGraph] ${scriptName} stdin write failed: ${err.message}`);
      }
      try { python.kill('SIGTERM'); } catch (_) {}
      resolve(null);
    }
  });
}

module.exports = {
  spawnPythonASTParser,
  // Exposed for testing the concurrency semaphore
  getActiveParserCount: () => activeParsers,
};
