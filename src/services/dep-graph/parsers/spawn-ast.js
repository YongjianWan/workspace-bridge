const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { TIMEOUTS, LIMITS } = require('../../../config/constants');

async function spawnPythonASTParser(scriptName, content, timeoutMs = TIMEOUTS.PYTHON_AST_PARSE_MS) {
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
      timeout: timeoutMs,
    });

    let output = '';
    let errorOutput = '';
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      python.kill('SIGTERM');
    }, timeoutMs);

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
      clearTimeout(timer);
      if (killed || code !== 0) {
        if (process.env.DEBUG) {
          console.error(`[DepGraph] ${scriptName} parse failed: exitCode=${code}, stderr=${errorOutput}`);
        }
        resolve(null);
        return;
      }
      try {
        const result = JSON.parse(output);
        resolve(result);
      } catch (e) {
        if (process.env.DEBUG) {
          console.error(`[DepGraph] ${scriptName} JSON parse failed: ${e.message}`);
        }
        resolve(null);
      }
    });

    python.on('error', (err) => {
      clearTimeout(timer);
      if (process.env.DEBUG) {
        console.error(`[DepGraph] ${scriptName} spawn failed: ${err.message}`);
      }
      resolve(null);
    });

    python.stdin.write(content, 'utf8');
    python.stdin.end();
  });
}

module.exports = { spawnPythonASTParser };
