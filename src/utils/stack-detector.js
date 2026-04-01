/**
 * Stack Detector - Detect project tech stack and generate concrete commands
 */
const fs = require('fs');
const path = require('path');
const { pathExists, readJsonSafe } = require('./path');

function hasPythonProject(root) {
  return (
    pathExists(path.join(root, 'requirements.txt')) ||
    pathExists(path.join(root, 'pyproject.toml')) ||
    pathExists(path.join(root, 'manage.py'))
  );
}

function hasNodeProject(root) {
  return (
    pathExists(path.join(root, 'package.json')) ||
    pathExists(path.join(root, 'package-lock.json')) ||
    pathExists(path.join(root, 'pnpm-lock.yaml')) ||
    pathExists(path.join(root, 'yarn.lock')) ||
    pathExists(path.join(root, 'bun.lock')) ||
    pathExists(path.join(root, 'bun.lockb'))
  );
}

function detectNodePackageManager(root) {
  if (pathExists(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (pathExists(path.join(root, 'yarn.lock'))) return 'yarn';
  if (pathExists(path.join(root, 'bun.lockb')) || pathExists(path.join(root, 'bun.lock'))) return 'bun';
  if (pathExists(path.join(root, 'package-lock.json'))) return 'npm';
  if (pathExists(path.join(root, 'package.json'))) return 'npm';
  return null;
}

function detectTestRunner(root) {
  if (pathExists(path.join(root, 'jest.config.js')) ||
      pathExists(path.join(root, 'jest.config.ts')) ||
      pathExists(path.join(root, 'jest.config.mjs'))) {
    return { name: 'jest', type: 'node' };
  }
  if (pathExists(path.join(root, 'vitest.config.ts')) ||
      pathExists(path.join(root, 'vitest.config.js')) ||
      pathExists(path.join(root, 'vitest.config.mjs'))) {
    return { name: 'vitest', type: 'node' };
  }
  if (pathExists(path.join(root, '.mocharc.js')) ||
      pathExists(path.join(root, '.mocharc.yml')) ||
      pathExists(path.join(root, '.mocharc.json'))) {
    return { name: 'mocha', type: 'node' };
  }
  if (pathExists(path.join(root, 'pytest.ini')) ||
      pathExists(path.join(root, 'setup.cfg')) ||
      pathExists(path.join(root, 'pyproject.toml'))) {
    return { name: 'pytest', type: 'python' };
  }

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

function detectPythonTestRunner(root) {
  if (pathExists(path.join(root, 'pytest.ini'))) return 'pytest';
  if (pathExists(path.join(root, 'setup.cfg'))) return 'pytest';
  if (pathExists(path.join(root, 'pyproject.toml'))) {
    try {
      const content = fs.readFileSync(path.join(root, 'pyproject.toml'), 'utf8');
      if (content.includes('pytest') || content.includes('[tool.pytest')) {
        return 'pytest';
      }
    } catch {
      // ignore read errors
    }
  }
  return null;
}

function detectLinters(root) {
  const linters = {
    node: [],
    python: [],
  };

  if (pathExists(path.join(root, '.eslintrc.js')) ||
      pathExists(path.join(root, '.eslintrc.cjs')) ||
      pathExists(path.join(root, '.eslintrc.json')) ||
      pathExists(path.join(root, 'eslint.config.js'))) {
    linters.node.push('eslint');
  }
  if (pathExists(path.join(root, '.prettierrc')) ||
      pathExists(path.join(root, '.prettierrc.json')) ||
      pathExists(path.join(root, 'prettier.config.js'))) {
    linters.node.push('prettier');
  }
  if (pathExists(path.join(root, 'pyproject.toml'))) {
    try {
      const content = fs.readFileSync(path.join(root, 'pyproject.toml'), 'utf8');
      if (content.includes('ruff') || content.includes('[tool.ruff]')) {
        linters.python.push('ruff');
      }
    } catch {
      // ignore read errors
    }
  }

  return linters;
}

function detectTypeCheckers(root) {
  const typeCheckers = {
    node: null,
    python: null,
  };

  if (pathExists(path.join(root, 'tsconfig.json'))) {
    typeCheckers.node = 'tsc';
  }
  if (pathExists(path.join(root, 'pyproject.toml'))) {
    const content = fs.readFileSync(path.join(root, 'pyproject.toml'), 'utf8');
    if (content.includes('pyright') || content.includes('[tool.pyright]')) {
      typeCheckers.python = 'pyright';
    }
  }

  return typeCheckers;
}

function detectDocsTool(root) {
  if (pathExists(path.join(root, 'mkdocs.yml'))) return 'mkdocs';
  if (pathExists(path.join(root, 'docusaurus.config.js'))) return 'docusaurus';
  if (pathExists(path.join(root, 'vitepress.config.js'))) return 'vitepress';
  return null;
}

function detectStack(root) {
  const hasNode = hasNodeProject(root);
  const hasPython = hasPythonProject(root);
  const nodePackageManager = detectNodePackageManager(root);
  const testRunner = detectTestRunner(root);
  const pythonTestRunner = detectPythonTestRunner(root);
  const linters = detectLinters(root);
  const typeCheckers = detectTypeCheckers(root);

  let profile = 'unknown';
  if (hasNode && hasPython) profile = 'mixed';
  else if (hasNode) profile = 'node-first';
  else if (hasPython) profile = 'python-first';

  return {
    profile,
    packageManager: hasNode ? nodePackageManager : hasPython ? 'pip' : null,
    docsTool: detectDocsTool(root),
    node: hasNode ? {
      enabled: true,
      packageManager: nodePackageManager,
      testRunner: testRunner?.type === 'node' ? testRunner.name : null,
      linters: linters.node,
      typeChecker: typeCheckers.node,
    } : null,
    python: hasPython ? {
      enabled: true,
      packageManager: 'pip',
      testRunner: pythonTestRunner || (testRunner?.type === 'python' ? testRunner.name : null),
      linters: linters.python,
      typeChecker: typeCheckers.python,
      framework: pathExists(path.join(root, 'manage.py'))
        ? 'django'
        : (() => {
          if (!pathExists(path.join(root, 'requirements.txt'))) return null;
          try {
            const content = fs.readFileSync(path.join(root, 'requirements.txt'), 'utf8');
            return content.toLowerCase().includes('fastapi') ? 'fastapi' : null;
          } catch {
            return null;
          }
        })(),
    } : null,
  };
}

function nodeExec(packageManager) {
  if (packageManager === 'npm') return { run: 'npm run', exec: 'npx' };
  if (['pnpm', 'yarn', 'bun'].includes(packageManager)) {
    return { run: `${packageManager} run`, exec: `${packageManager} exec` };
  }
  return null;
}

function getNodeCommands(nodeStack, changeType, targets) {
  if (!nodeStack?.enabled) return { smoke: [], focused: [], full: [] };
  const exec = nodeExec(nodeStack.packageManager);
  if (!exec) return { smoke: [], focused: [], full: [] };

  const fileArgs = targets.length > 0 ? targets.join(' ') : '.';
  const commands = { smoke: [], focused: [], full: [] };

  if (changeType === 'code' || changeType === 'tests' || changeType === 'config') {
    if (nodeStack.linters.includes('eslint')) {
      commands.smoke.push({ name: 'node-lint', description: 'Run ESLint on changed files', cmd: `${exec.exec} eslint ${fileArgs}` });
    }
    if (nodeStack.typeChecker === 'tsc') {
      commands.smoke.push({ name: 'node-type-check', description: 'Run TypeScript type check', cmd: `${exec.exec} tsc --noEmit` });
    }
    if (nodeStack.testRunner) {
      const testCmd = nodeStack.testRunner === 'vitest'
        ? `${exec.exec} vitest run ${targets.join(' ')}`
        : nodeStack.testRunner === 'jest'
          ? `${exec.exec} jest ${targets.join(' ')}`
          : nodeStack.testRunner === 'mocha'
            ? `${exec.exec} mocha ${targets.join(' ')}`
          : `${exec.run} test`;
      if (targets.length > 0) {
        commands.focused.push({ name: 'node-focused-tests', description: 'Run node-side focused tests', cmd: testCmd });
      }
    }
    commands.full.push({ name: 'node-all-tests', description: 'Run node-side full test suite', cmd: `${exec.run} test` });
  }

  return commands;
}

function getPythonCommands(pythonStack, changeType, targets) {
  if (!pythonStack?.enabled) return { smoke: [], focused: [], full: [] };
  if (changeType !== 'code' && changeType !== 'tests' && changeType !== 'config') {
    return { smoke: [], focused: [], full: [] };
  }
  const fileArgs = targets.length > 0 ? targets.join(' ') : '.';
  const commands = { smoke: [], focused: [], full: [] };

  if (pythonStack.linters.includes('ruff')) {
    commands.smoke.push({ name: 'python-lint', description: 'Run Ruff on changed files', cmd: `ruff check ${fileArgs}` });
  }
  if (pythonStack.typeChecker === 'pyright') {
    commands.smoke.push({ name: 'python-type-check', description: 'Run Pyright', cmd: 'pyright' });
  }
  if (pythonStack.testRunner === 'pytest') {
    if (targets.length > 0) {
      commands.focused.push({ name: 'python-focused-tests', description: 'Run python-side focused tests', cmd: `pytest ${fileArgs}` });
    }
    commands.full.push({ name: 'python-all-tests', description: 'Run python-side full test suite', cmd: 'pytest' });
  }
  if (changeType === 'config' && pythonStack.framework === 'django') {
    commands.focused.push({ name: 'django-check', description: 'Run Django system checks', cmd: 'python manage.py check' });
  }

  return commands;
}

function mergeCommandSets(...sets) {
  const merged = { smoke: [], focused: [], full: [] };
  for (const set of sets) {
    if (!set) continue;
    for (const phase of ['smoke', 'focused', 'full']) {
      merged[phase].push(...(set[phase] || []));
    }
  }
  return merged;
}

function getDocsCommands(stack, changeType) {
  if (changeType !== 'docs') return null;
  switch (stack.docsTool) {
    case 'mkdocs':
      return { serve: 'mkdocs serve', build: 'mkdocs build' };
    case 'docusaurus': {
      const exec = nodeExec(stack.node?.packageManager || stack.packageManager);
      return exec ? { serve: `${exec.run} start`, build: `${exec.run} build` } : null;
    }
    case 'vitepress': {
      const exec = nodeExec(stack.node?.packageManager || stack.packageManager);
      return exec ? { serve: `${exec.run} docs:dev`, build: `${exec.run} docs:build` } : null;
    }
    default:
      return null;
  }
}

function generateCommands(stack, changeType, targets, steps = []) {
  const docsCommands = getDocsCommands(stack, changeType);
  if (changeType === 'docs' && docsCommands) {
    return {
      smoke: [{ name: 'preview-docs', description: 'Start docs preview server', cmd: docsCommands.serve }],
      focused: [{ name: 'build-docs', description: 'Build docs to catch broken pages', cmd: docsCommands.build }],
      full: [],
    };
  }

  const nodeTargets = targets.filter((file) => /\.(js|jsx|ts|tsx|json|mjs|cjs)$/.test(file));
  const pythonTargets = targets.filter((file) => /\.py$/.test(file));

  const nodeCommands = getNodeCommands(stack.node, changeType, nodeTargets);
  const pythonCommands = getPythonCommands(stack.python, changeType, pythonTargets);
  const merged = mergeCommandSets(nodeCommands, pythonCommands);

  if (stack.profile === 'mixed') {
    if (!merged.full.some((entry) => entry.name === 'mixed-review')) {
      merged.full.unshift({
        name: 'mixed-review',
        description: 'Review both Node and Python validation results together',
        cmd: 'echo "Review node and python command output together before merge"',
      });
    }
  }

  return merged;
}

module.exports = {
  detectStack,
  generateCommands,
};
