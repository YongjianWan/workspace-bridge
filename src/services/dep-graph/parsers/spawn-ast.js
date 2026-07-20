const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { TIMEOUTS, LIMITS } = require('../../../config/constants');
const { buildSafeEnv, resolvePythonCommand } = require('../../../utils/command');

// Module-level semaphore to bound Python sub-process memory.
// Each Python process uses 30-80MB; on large Java/Python repos,
// unbounded concurrency can spike to 600MB-1.6GB.
let activeParsers = 0;
const parserQueue = [];

// Environment-level parser failures memoized per script for this process.
// 'python-missing' (spawn ENOENT) and 'dependency-missing' (ModuleNotFoundError)
// recur for every file — retrying per-file just burns spawn cycles, so
// subsequent calls for the same script short-circuit to null.
// Transient failures (timeout, bad JSON, script-level crash) are NOT memoized:
// they may be file-specific. In-memory only; a new process re-probes, so
// installing the missing dependency mid-session requires no cache clearing.
const parserEnvFailures = new Map();

function getParserEnvFailure(scriptName) {
  return parserEnvFailures.get(scriptName);
}

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

// Prefer the workspace virtualenv python (where the project actually installs
// deps like javalang); fall back to the historical platform default.
// resolvePythonCommand returns bare 'python' when no venv exists — detect
// that and keep the platform default so non-Windows keeps python3.
function resolveParserPython(root) {
  if (root) {
    const resolved = resolvePythonCommand(root);
    if (resolved && resolved !== 'python') return resolved;
  }
  return process.platform === 'win32' ? 'python' : 'python3';
}

async function spawnPythonASTParser(scriptName, content, timeoutMs = TIMEOUTS.PYTHON_AST_PARSE_MS, root = null) {
  if (parserEnvFailures.has(scriptName)) {
    return null;
  }
  await acquireParserSlot();
  try {
    return await _spawnPythonASTParser(scriptName, content, timeoutMs, root);
  } finally {
    releaseParserSlot();
  }
}

function _spawnPythonASTParser(scriptName, content, timeoutMs, root) {
  return new Promise((resolve) => {
    const pythonCmd = resolveParserPython(root);
    const scriptPath = path.join(__dirname, '..', '..', '..', '..', 'scripts', scriptName);

    if (!fs.existsSync(scriptPath)) {
      resolve(null);
      return;
    }

    // Write content to a temp file to bypass Windows Store Python stdin pipe
    // crashes (exit code 49) when piping large or frequent data via Git Bash.
    // This is a zero-architecture-risk workaround: the Python script reads
    // the file path from --file argument instead of sys.stdin.
    const tempDir = os.tmpdir();
    const tempName = `wb-ast-${crypto.randomBytes(8).toString('hex')}.txt`;
    const tempPath = path.join(tempDir, tempName);

    try {
      fs.writeFileSync(tempPath, content, 'utf8');
    } catch (writeErr) {
      if (process.env.DEBUG) {
        console.error(`[DepGraph] temp file write failed: ${writeErr.message}`);
      }
      resolve(null);
      return;
    }

    function cleanupTempFile() {
      try {
        fs.unlinkSync(tempPath);
      } catch (_) {
        // ignore
      }
    }

    const python = spawn(pythonCmd, [scriptPath, '--file', tempPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: buildSafeEnv({ PYTHONIOENCODING: 'utf-8' }),
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
      cleanupTempFile();
      if (killed || code !== 0) {
        if (!killed && /ModuleNotFoundError|ImportError|No module named/.test(errorOutput)) {
          // External parser dependency not installed (e.g. javalang) — env-level, memoize.
          parserEnvFailures.set(scriptName, 'dependency-missing');
        }
        if (process.env.DEBUG) {
          console.error(`[DepGraph] ${scriptName} parse failed: exitCode=${code}, stderr=${errorOutput}`);
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
      cleanupTempFile();
      // spawn failure (e.g. ENOENT — python executable not found) is env-level.
      parserEnvFailures.set(scriptName, 'python-missing');
      if (process.env.DEBUG) {
        console.error(`[DepGraph] ${scriptName} spawn failed: ${err.message}`);
      }
      resolve(null);
    });


  });
}

module.exports = {
  spawnPythonASTParser,
  getParserEnvFailure,
  // Exposed for testing the concurrency semaphore
  getActiveParserCount: () => activeParsers,
};
