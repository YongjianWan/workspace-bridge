const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { TIMEOUTS, LIMITS } = require('../../../config/constants');
const { uniqueNames, createExportRecord, createImportRecord } = require('./shared');

async function parseJavaAST(content) {
  return new Promise((resolve) => {
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    const scriptPath = path.join(__dirname, '..', '..', '..', '..', 'scripts', 'java_ast_parser.py');

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
          console.error(`[DepGraph] Java AST parse failed: exitCode=${code}, stderr=${errorOutput}`);
        }
        resolve(null);
        return;
      }
      try {
        const result = JSON.parse(output);
        resolve(result);
      } catch (e) {
        if (process.env.DEBUG) {
          console.error(`[DepGraph] Java AST JSON parse failed: ${e.message}`);
        }
        resolve(null);
      }
    });

    python.on('error', (err) => {
      clearTimeout(timer);
      if (process.env.DEBUG) {
        console.error(`[DepGraph] Java spawn failed: ${err.message}`);
      }
      resolve(null);
    });

    python.stdin.write(content, 'utf8');
    python.stdin.end();
  });
}

function parseJavaWithRegex(content) {
  const imports = [];
  const importRecords = [];
  const exportRecords = [];

  const importRegex = /^\s*import\s+(static\s+)?([a-zA-Z_][\w.]*(?:\.\*)?)\s*;/gm;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const source = match[2];
    const isWildcard = source.endsWith('.*');
    const imported = isWildcard ? [] : [source.split('.').pop()];
    imports.push(source);
    importRecords.push(createImportRecord(source, { imported, usesAllExports: isWildcard }));
  }

  const exportRegex = /\bpublic\s+(?:abstract\s+|final\s+)?(?:class|interface|enum|record)\s+([A-Za-z_]\w*)/g;
  while ((match = exportRegex.exec(content)) !== null) {
    exportRecords.push(createExportRecord(match[1], { kind: 'class' }));
  }

  const exports = uniqueNames(exportRecords.map((record) => record.name));
  return {
    imports: uniqueNames(imports),
    exports,
    importRecords,
    exportRecords,
    parseMode: 'regex',
  };
}

async function parseJava(content) {
  const astResult = await parseJavaAST(content);
  if (astResult) {
    return {
      imports: uniqueNames(astResult.imports),
      exports: uniqueNames(astResult.exports),
      importRecords: (astResult.importRecords || []).map((record) =>
        createImportRecord(record.source, {
          imported: record.imported,
          usesAllExports: record.usesAllExports,
          isStatic: record.isStatic,
        })
      ),
      exportRecords: uniqueNames(astResult.exports).map((name) =>
        createExportRecord(name, { kind: 'symbol' })
      ),
      parseMode: 'ast',
    };
  }
  const regexResult = parseJavaWithRegex(content);
  return { ...regexResult, parseMode: 'regex' };
}

module.exports = { parseJava };
