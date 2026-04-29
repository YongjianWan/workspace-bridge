const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { TIMEOUTS, LIMITS } = require('../../../config/constants');
const { uniqueNames, createImportRecord } = require('./shared');

async function parsePythonAST(content) {
  return new Promise((resolve) => {
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    const scriptPath = path.join(__dirname, '..', '..', '..', '..', 'scripts', 'python_ast_parser.py');

    if (!fs.existsSync(scriptPath)) {
      resolve(null);
      return;
    }

    const python = spawn(pythonCmd, [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: TIMEOUTS.PYTHON_AST_PARSE_MS,
    });

    let output = '';
    let errorOutput = '';
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      python.kill('SIGTERM');
    }, TIMEOUTS.PYTHON_AST_PARSE_MS);

    python.stdout.on('data', (data) => {
      output += data.toString('utf8');
      if (output.length > LIMITS.COMMAND_OUTPUT_MAX_BYTES) {
        output = output.slice(0, LIMITS.COMMAND_OUTPUT_MAX_BYTES) + '\n...[truncated]';
        python.stdout.destroy();
      }
    });

    python.stderr.on('data', (data) => {
      errorOutput += data.toString('utf8');
      if (errorOutput.length > LIMITS.COMMAND_OUTPUT_MAX_BYTES) {
        errorOutput = errorOutput.slice(0, LIMITS.COMMAND_OUTPUT_MAX_BYTES) + '\n...[truncated]';
        python.stderr.destroy();
      }
    });

    python.on('close', (code) => {
      clearTimeout(timer);
      if (killed || code !== 0) {
        if (process.env.DEBUG) {
          console.error(`[DepGraph] Python AST parse failed: exitCode=${code}, stderr=${errorOutput}`);
        }
        resolve(null);
        return;
      }
      try {
        const result = JSON.parse(output);
        resolve(result);
      } catch (e) {
        if (process.env.DEBUG) {
          console.error(`[DepGraph] Python AST JSON parse failed: ${e.message}`);
        }
        resolve(null);
      }
    });

    python.on('error', (err) => {
      clearTimeout(timer);
      if (process.env.DEBUG) {
        console.error(`[DepGraph] Python spawn failed: ${err.message}`);
      }
      resolve(null);
    });

    python.stdin.write(content, 'utf8');
    python.stdin.end();
  });
}

function parsePythonWithRegex(content) {
  const imports = [];
  const importRecords = [];
  const exports = [];

  const importRegex = /^(?:from\s+(\S+)\s+import|import\s+(\S+))/gm;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const module = match[1] || match[2];
    if (module) {
      imports.push(module);
      importRecords.push(createImportRecord(module, { usesAllExports: true }));
    }
  }

  const classRegex = /^class\s+(\w+)/gm;
  const funcRegex = /^(?:async\s+)?def\s+(\w+)/gm;

  while ((match = classRegex.exec(content)) !== null) {
    if (!match[1].startsWith('_')) exports.push(match[1]);
  }
  while ((match = funcRegex.exec(content)) !== null) {
    if (!match[1].startsWith('_')) exports.push(match[1]);
  }

  return { imports, exports, importRecords, parseMode: 'regex' };
}

async function parsePython(content) {
  const astResult = await parsePythonAST(content);
  if (astResult) {
    return {
      imports: uniqueNames(astResult.imports),
      exports: uniqueNames(astResult.exports),
      importRecords: astResult.importRecords.map((record) =>
        createImportRecord(record.source, {
          imported: record.imported,
          usesAllExports: record.usesAllExports,
        })
      ),
      parseMode: 'ast',
    };
  }

  return parsePythonWithRegex(content);
}

module.exports = { parsePython };
