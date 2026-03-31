/**
 * Stack Detector - Detect project tech stack and generate concrete commands
 */
const fs = require('fs');
const path = require('path');
const { pathExists, readJsonSafe } = require('./path');

function detectPackageManager(root) {
  if (pathExists(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (pathExists(path.join(root, 'yarn.lock'))) return 'yarn';
  if (pathExists(path.join(root, 'bun.lockb')) || pathExists(path.join(root, 'bun.lock'))) return 'bun';
  if (pathExists(path.join(root, 'package-lock.json'))) return 'npm';
  return 'npm'; // default
}

function detectTestRunner(root) {
  // Jest
  if (pathExists(path.join(root, 'jest.config.js')) ||
      pathExists(path.join(root, 'jest.config.ts')) ||
      pathExists(path.join(root, 'jest.config.mjs'))) {
    return { name: 'jest', type: 'node' };
  }
  // Vitest
  if (pathExists(path.join(root, 'vitest.config.ts')) ||
      pathExists(path.join(root, 'vitest.config.js')) ||
      pathExists(path.join(root, 'vitest.config.mjs'))) {
    return { name: 'vitest', type: 'node' };
  }
  // Mocha
  if (pathExists(path.join(root, '.mocharc.js')) ||
      pathExists(path.join(root, '.mocharc.yml')) ||
      pathExists(path.join(root, '.mocharc.json'))) {
    return { name: 'mocha', type: 'node' };
  }
  // Pytest
  if (pathExists(path.join(root, 'pytest.ini')) ||
      pathExists(path.join(root, 'setup.cfg')) ||
      pathExists(path.join(root, 'pyproject.toml'))) {
    return { name: 'pytest', type: 'python' };
  }
  // Check package.json scripts
  const packageJsonPath = path.join(root, 'package.json');
  if (pathExists(packageJsonPath)) {
    const pkg = readJsonSafe(packageJsonPath);
    const scripts = pkg?.scripts || {};
    const testScript = scripts.test || '';
    if (testScript.includes('jest')) return { name: 'jest', type: 'node' };
    if (testScript.includes('vitest')) return { name: 'vitest', type: 'node' };
    if (testScript.includes('mocha')) return { name: 'mocha', type: 'node' };
  }
  return null;
}

function detectLinter(root) {
  const linters = [];
  if (pathExists(path.join(root, '.eslintrc.js')) ||
      pathExists(path.join(root, '.eslintrc.cjs')) ||
      pathExists(path.join(root, '.eslintrc.json')) ||
      pathExists(path.join(root, 'eslint.config.js'))) {
    linters.push('eslint');
  }
  if (pathExists(path.join(root, '.prettierrc')) ||
      pathExists(path.join(root, '.prettierrc.json')) ||
      pathExists(path.join(root, 'prettier.config.js'))) {
    linters.push('prettier');
  }
  if (pathExists(path.join(root, 'pyproject.toml'))) {
    try {
      const content = fs.readFileSync(path.join(root, 'pyproject.toml'), 'utf8');
      if (content.includes('ruff') || content.includes('[tool.ruff]')) {
        linters.push('ruff');
      }
    } catch (e) {
      // ignore read errors
    }
  }
  return linters;
}

function detectTypeChecker(root) {
  if (pathExists(path.join(root, 'tsconfig.json'))) {
    return 'tsc';
  }
  if (pathExists(path.join(root, 'pyproject.toml'))) {
    const content = fs.readFileSync(path.join(root, 'pyproject.toml'), 'utf8');
    if (content.includes('pyright') || content.includes('[tool.pyright]')) {
      return 'pyright';
    }
  }
  return null;
}

function detectDocsTool(root) {
  if (pathExists(path.join(root, 'mkdocs.yml'))) return 'mkdocs';
  if (pathExists(path.join(root, 'docusaurus.config.js'))) return 'docusaurus';
  if (pathExists(path.join(root, 'vitepress.config.js'))) return 'vitepress';
  return null;
}

function detectStack(root) {
  return {
    packageManager: detectPackageManager(root),
    testRunner: detectTestRunner(root),
    linters: detectLinter(root),
    typeChecker: detectTypeChecker(root),
    docsTool: detectDocsTool(root),
  };
}

function getRunCommand(stack, targetFiles = []) {
  const { packageManager, testRunner } = stack;
  const fileArgs = targetFiles.length > 0 ? targetFiles.join(' ') : '';

  if (!testRunner) {
    return packageManager === 'npm' ? `npm test` : `${packageManager} test`;
  }

  const pmRun = packageManager === 'npm' ? 'npm run' : `${packageManager} run`;
  const pmExec = packageManager === 'npm' ? 'npx' : `${packageManager} exec`;

  switch (testRunner.name) {
    case 'jest':
      return targetFiles.length > 0
        ? `${pmExec} jest ${fileArgs}`
        : `${pmRun} test`;
    case 'vitest':
      return targetFiles.length > 0
        ? `${pmExec} vitest run ${fileArgs}`
        : `${pmRun} test`;
    case 'mocha':
      return targetFiles.length > 0
        ? `${pmExec} mocha ${fileArgs}`
        : `${pmRun} test`;
    case 'pytest':
      return targetFiles.length > 0
        ? `pytest ${fileArgs}`
        : 'pytest';
    default:
      return `${pmRun} test`;
  }
}

function getLintCommand(stack, targetFiles = []) {
  const { packageManager, linters } = stack;
  const fileArgs = targetFiles.length > 0 ? targetFiles.join(' ') : '.';
  const pmExec = packageManager === 'npm' ? 'npx' : `${packageManager} exec`;

  const commands = [];
  for (const linter of linters) {
    switch (linter) {
      case 'eslint':
        commands.push(`${pmExec} eslint ${fileArgs}`);
        break;
      case 'prettier':
        commands.push(`${pmExec} prettier --check ${fileArgs}`);
        break;
      case 'ruff':
        commands.push(`ruff check ${fileArgs}`);
        break;
    }
  }
  return commands;
}

function getTypeCheckCommand(stack) {
  const { typeChecker, packageManager } = stack;
  const pmExec = packageManager === 'npm' ? 'npx' : `${packageManager} exec`;

  switch (typeChecker) {
    case 'tsc':
      return `${pmExec} tsc --noEmit`;
    case 'pyright':
      return `${pmExec} pyright`;
    default:
      return null;
  }
}

function getDocsCommands(stack, changeType) {
  const { docsTool, packageManager } = stack;
  const pmRun = packageManager === 'npm' ? 'npm run' : `${packageManager} run`;

  if (changeType === 'docs') {
    switch (docsTool) {
      case 'mkdocs':
        return {
          serve: 'mkdocs serve',
          build: 'mkdocs build',
        };
      case 'docusaurus':
        return {
          serve: `${pmRun} start`,
          build: `${pmRun} build`,
        };
      case 'vitepress':
        return {
          serve: `${pmRun} docs:dev`,
          build: `${pmRun} docs:build`,
        };
      default:
        return null;
    }
  }
  return null;
}

function generateCommands(stack, changeType, targets, steps = []) {
  const commands = {
    smoke: [],
    focused: [],
    full: [],
  };

  const { packageManager } = stack;
  const pmRun = packageManager === 'npm' ? 'npm run' : `${packageManager} run`;

  // Smoke commands based on change type
  switch (changeType) {
    case 'docs': {
      commands.smoke.push({
        name: 'preview-docs',
        description: 'Start docs preview server',
        cmd: getDocsCommands(stack, changeType)?.serve || `cat ${targets[0] || 'README.md'}`,
      });
      break;
    }
    case 'config': {
      const typeCheckCmd = getTypeCheckCommand(stack);
      if (typeCheckCmd) {
        commands.smoke.push({
          name: 'type-check',
          description: 'Run type checker on project',
          cmd: typeCheckCmd,
        });
      }
      break;
    }
    case 'code':
    default: {
      // Lint changed files
      const lintCmds = getLintCommand(stack, targets);
      for (const cmd of lintCmds.slice(0, 1)) {
        commands.smoke.push({
          name: 'lint',
          description: 'Run linter on changed files',
          cmd,
        });
      }
      // Type check
      const typeCheckCmd = getTypeCheckCommand(stack);
      if (typeCheckCmd) {
        commands.smoke.push({
          name: 'type-check',
          description: 'Run type checker',
          cmd: typeCheckCmd,
        });
      }
      break;
    }
  }

  // Focused commands
  if (changeType === 'code' || changeType === 'tests') {
    // Direct tests
    const testFiles = steps.find(s => s.name === 'run-direct-tests')?.targets || [];
    if (testFiles.length > 0) {
      commands.focused.push({
        name: 'run-direct-tests',
        description: 'Run directly affected tests',
        cmd: getRunCommand(stack, testFiles),
      });
    }
  }

  if (changeType === 'docs') {
    commands.focused.push({
      name: 'check-links',
      description: 'Check for broken internal links',
      cmd: getDocsCommands(stack, changeType)?.build || 'echo "Check links manually"',
    });
  }

  if (changeType === 'config') {
    commands.focused.push({
      name: 'start-app',
      description: 'Start application to verify config loads',
      cmd: `${pmRun} start 2>&1 | head -20 || echo "Check if app starts correctly"`,
    });
  }

  // Full commands
  switch (changeType) {
    case 'docs': {
      commands.full.push({
        name: 'build-docs',
        description: 'Build documentation',
        cmd: getDocsCommands(stack, changeType)?.build || 'echo "No docs build command found"',
      });
      break;
    }
    case 'tests':
    case 'code': {
      commands.full.push({
        name: 'run-all-tests',
        description: 'Run full test suite',
        cmd: getRunCommand(stack),
      });
      const lintCmds = getLintCommand(stack);
      if (lintCmds.length > 0) {
        commands.full.push({
          name: 'lint-all',
          description: 'Run linter on entire project',
          cmd: lintCmds[0].replace(/\s+\S+$/, ' .'), // Replace file args with '.'
        });
      }
      break;
    }
    case 'config': {
      commands.full.push({
        name: 'run-all-tests',
        description: 'Run full test suite to catch config side effects',
        cmd: getRunCommand(stack),
      });
      break;
    }
  }

  return commands;
}

module.exports = {
  detectStack,
  getRunCommand,
  getLintCommand,
  getTypeCheckCommand,
  getDocsCommands,
  generateCommands,
};
