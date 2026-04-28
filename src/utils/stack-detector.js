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

function hasJavaProject(root) {
  return (
    pathExists(path.join(root, 'pom.xml')) ||
    pathExists(path.join(root, 'build.gradle')) ||
    pathExists(path.join(root, 'build.gradle.kts'))
  );
}

function hasGoProject(root) {
  return pathExists(path.join(root, 'go.mod'));
}

function hasRustProject(root) {
  return pathExists(path.join(root, 'Cargo.toml'));
}

function detectJavaBuildTool(root) {
  if (pathExists(path.join(root, 'pom.xml'))) return 'maven';
  if (pathExists(path.join(root, 'build.gradle')) || pathExists(path.join(root, 'build.gradle.kts'))) return 'gradle';
  return null;
}

function detectJavaBuildCommand(root, buildTool) {
  if (buildTool === 'maven') {
    if (pathExists(path.join(root, 'mvnw.cmd'))) return 'mvnw.cmd';
    if (pathExists(path.join(root, 'mvnw'))) return './mvnw';
    return 'mvn';
  }
  if (buildTool === 'gradle') {
    if (pathExists(path.join(root, 'gradlew.bat'))) return 'gradlew.bat';
    if (pathExists(path.join(root, 'gradlew'))) return './gradlew';
    return 'gradle';
  }
  return null;
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

function detectPythonTestRunner(root, pyprojectText = '') {
  if (pathExists(path.join(root, 'pytest.ini'))) return 'pytest';
  if (pathExists(path.join(root, 'setup.cfg'))) return 'pytest';
  if (pyprojectText && (pyprojectText.includes('pytest') || pyprojectText.includes('[tool.pytest'))) {
    return 'pytest';
  }
  return null;
}

function readTextIfExists(filePath) {
  if (!pathExists(filePath)) return '';
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function detectPythonFramework(root, pyprojectText = '') {
  if (pathExists(path.join(root, 'manage.py'))) return 'django';

  const requirementsFiles = [
    'requirements.txt',
    'requirements-dev.txt',
    'requirements/base.txt',
  ].map((name) => path.join(root, name));

  const combined = [
    ...requirementsFiles.map(readTextIfExists),
    pyprojectText,
  ].join('\n').toLowerCase();

  if (!combined) return null;
  if (/\bfastapi\b/.test(combined)) return 'fastapi';
  if (/\bflask\b/.test(combined)) return 'flask';
  return null;
}

function detectLinters(root, pyprojectText = '') {
  const linters = {
    node: [],
    python: [],
    java: [],
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
  if (pyprojectText && (pyprojectText.includes('ruff') || pyprojectText.includes('[tool.ruff]'))) {
    linters.python.push('ruff');
  }

  // Java linters
  if (pathExists(path.join(root, 'checkstyle.xml')) ||
      pathExists(path.join(root, 'config/checkstyle/checkstyle.xml'))) {
    linters.java.push('checkstyle');
  }
  const buildGradleText = readTextIfExists(path.join(root, 'build.gradle')) +
    readTextIfExists(path.join(root, 'build.gradle.kts')) +
    readTextIfExists(path.join(root, 'pom.xml'));
  if (/\bspotbugs\b/.test(buildGradleText)) linters.java.push('spotbugs');
  if (/\bpmd\b/.test(buildGradleText)) linters.java.push('pmd');
  if (/\berrorprone\b/.test(buildGradleText)) linters.java.push('errorprone');
  if (/\bjacoco\b/.test(buildGradleText)) linters.java.push('jacoco');

  return linters;
}

function detectTypeCheckers(root, pyprojectText = '') {
  const typeCheckers = {
    node: null,
    python: null,
    java: null,
  };

  if (pathExists(path.join(root, 'tsconfig.json'))) {
    typeCheckers.node = 'tsc';
  }
  if (pyprojectText && (pyprojectText.includes('pyright') || pyprojectText.includes('[tool.pyright]'))) {
    typeCheckers.python = 'pyright';
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
  const pyprojectText = readTextIfExists(path.join(root, 'pyproject.toml'));
  const hasNode = hasNodeProject(root);
  const hasPython = hasPythonProject(root);
  const hasJava = hasJavaProject(root);
  const hasGo = hasGoProject(root);
  const hasRust = hasRustProject(root);
  const nodePackageManager = detectNodePackageManager(root);
  const javaBuildTool = detectJavaBuildTool(root);
  const javaBuildCommand = detectJavaBuildCommand(root, javaBuildTool);
  const testRunner = detectTestRunner(root);
  const pythonTestRunner = detectPythonTestRunner(root, pyprojectText);
  const linters = detectLinters(root, pyprojectText);
  const typeCheckers = detectTypeCheckers(root, pyprojectText);

  let profile = 'unknown';
  const activeStacks = [hasNode, hasPython, hasJava, hasGo, hasRust].filter(Boolean).length;
  if (activeStacks >= 2) profile = 'mixed';
  else if (hasNode) profile = 'node-first';
  else if (hasPython) profile = 'python-first';
  else if (hasJava) profile = 'java-first';
  else if (hasGo) profile = 'go-first';
  else if (hasRust) profile = 'rust-first';

  return {
    profile,
    packageManager: hasNode ? nodePackageManager : hasPython ? 'pip' : hasJava ? javaBuildTool : null,
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
      framework: detectPythonFramework(root, pyprojectText),
    } : null,
    java: hasJava ? {
      enabled: true,
      buildTool: javaBuildTool,
      buildCommand: javaBuildCommand,
      testRunner: javaBuildTool === 'maven' ? 'surefire' : javaBuildTool === 'gradle' ? 'junit' : null,
      linters: linters.java,
      typeChecker: typeCheckers.java,
    } : null,
    go: hasGo ? { enabled: true, packageManager: 'go modules', testRunner: 'go test' } : null,
    rust: hasRust ? { enabled: true, packageManager: 'cargo', testRunner: 'cargo test' } : null,
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

function getJavaCommands(javaStack, changeType, targets) {
  if (!javaStack?.enabled) return { smoke: [], focused: [], full: [] };
  if (changeType !== 'code' && changeType !== 'tests' && changeType !== 'config') {
    return { smoke: [], focused: [], full: [] };
  }
  const commands = { smoke: [], focused: [], full: [] };
  const hasJavaFiles = targets.some((file) => /\.java$/.test(file));
  const javaCmd = javaStack.buildCommand || (javaStack.buildTool === 'maven' ? 'mvn' : javaStack.buildTool === 'gradle' ? 'gradle' : null);
  if (!javaCmd) return commands;
  if (javaStack.buildTool === 'maven') {
    commands.smoke.push({ name: 'java-compile-check', description: 'Run Maven compile check', cmd: `${javaCmd} -q -DskipTests compile` });
    if (hasJavaFiles) {
      commands.focused.push({ name: 'java-focused-tests', description: 'Run focused Maven tests', cmd: `${javaCmd} -q -Dtest=*Test test` });
    }
    commands.full.push({ name: 'java-all-tests', description: 'Run Java full test suite', cmd: `${javaCmd} -q test` });
  } else if (javaStack.buildTool === 'gradle') {
    commands.smoke.push({ name: 'java-compile-check', description: 'Run Gradle compile check', cmd: `${javaCmd} -q classes` });
    if (hasJavaFiles) {
      commands.focused.push({ name: 'java-focused-tests', description: 'Run focused Gradle tests', cmd: `${javaCmd} -q test --tests *Test` });
    }
    commands.full.push({ name: 'java-all-tests', description: 'Run Java full test suite', cmd: `${javaCmd} -q test` });
  }
  if (javaStack.linters.includes('checkstyle')) {
    if (javaStack.buildTool === 'maven') {
      commands.smoke.push({
        name: 'java-checkstyle',
        description: 'Run Checkstyle',
        cmd: `${javaCmd} checkstyle:check`,
      });
    } else if (javaStack.buildTool === 'gradle') {
      commands.smoke.push({
        name: 'java-checkstyle',
        description: 'Run Checkstyle',
        cmd: `${javaCmd} checkstyleMain checkstyleTest`,
      });
    }
  }
  return commands;
}

function getGoCommands(goStack, changeType, targets) {
  if (!goStack?.enabled) return { smoke: [], focused: [], full: [] };
  if (changeType !== 'code' && changeType !== 'tests' && changeType !== 'config') return { smoke: [], focused: [], full: [] };
  const commands = { smoke: [], focused: [], full: [] };
  commands.smoke.push({ name: 'go-build', description: 'Go build check', cmd: 'go build ./...' });
  if (targets.length > 0) {
    const goPackages = Array.from(new Set(
      targets.map((file) => path.dirname(file)).filter((dir) => dir && dir !== '.')
    ));
    if (goPackages.length > 0) {
      commands.focused.push({ name: 'go-focused-tests', description: 'Run affected Go packages', cmd: `go test ${goPackages.map((p) => `./${p}`).join(' ')}` });
    }
  }
  commands.full.push({ name: 'go-all-tests', description: 'Run all Go tests', cmd: 'go test ./...' });
  return commands;
}

function getRustCommands(rustStack, changeType, targets) {
  if (!rustStack?.enabled) return { smoke: [], focused: [], full: [] };
  if (changeType !== 'code' && changeType !== 'tests' && changeType !== 'config') return { smoke: [], focused: [], full: [] };
  const commands = { smoke: [], focused: [], full: [] };
  commands.smoke.push({ name: 'rust-check', description: 'Rust check', cmd: 'cargo check' });
  commands.full.push({ name: 'rust-all-tests', description: 'Run all Rust tests', cmd: 'cargo test' });
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

function addUniqueCommand(commands, phase, entry) {
  if (!entry?.cmd) return;
  const exists = commands[phase].some((item) => item.name === entry.name || item.cmd === entry.cmd);
  if (!exists) commands[phase].push(entry);
}

function splitTargetsByStack(targets) {
  const list = Array.isArray(targets) ? targets : [];
  return {
    node: list.filter((file) => /\.(js|jsx|ts|tsx|json|mjs|cjs)$/.test(file)),
    python: list.filter((file) => /\.py$/.test(file)),
    java: list.filter((file) => /\.java$/.test(file) || /(^|\/)(pom\.xml|build\.gradle|build\.gradle\.kts)$/.test(file)),
    go: list.filter((file) => /\.go$/.test(file) || /(^|\/)go\.mod$/.test(file)),
    rust: list.filter((file) => /\.rs$/.test(file) || /(^|\/)Cargo\.toml$/.test(file)),
  };
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
  const javaTargets = targets.filter((file) => /\.java$/.test(file) || /(^|\/)(pom\.xml|build\.gradle|build\.gradle\.kts)$/.test(file));
  const goTargets = targets.filter((file) => /\.go$/.test(file) || /(^|\/)go\.mod$/.test(file));
  const rustTargets = targets.filter((file) => /\.rs$/.test(file) || /(^|\/)Cargo\.toml$/.test(file));

  const nodeCommands = getNodeCommands(stack.node, changeType, nodeTargets);
  const pythonCommands = getPythonCommands(stack.python, changeType, pythonTargets);
  const javaCommands = getJavaCommands(stack.java, changeType, javaTargets);
  const goCommands = getGoCommands(stack.go, changeType, goTargets);
  const rustCommands = getRustCommands(stack.rust, changeType, rustTargets);
  const merged = mergeCommandSets(nodeCommands, pythonCommands, javaCommands, goCommands, rustCommands);

  // Prefer direct test targets from focused steps when available.
  const directTests = (steps || []).find((step) => step?.name === 'run-direct-tests')?.targets || [];
  if (directTests.length > 0) {
    const split = splitTargetsByStack(directTests);
    const nodeExecConfig = nodeExec(stack.node?.packageManager);

    if (split.node.length > 0 && stack.node?.enabled && nodeExecConfig) {
      const nodeDirectCmd = stack.node.testRunner === 'vitest'
        ? `${nodeExecConfig.exec} vitest run ${split.node.join(' ')}`
        : stack.node.testRunner === 'jest'
          ? `${nodeExecConfig.exec} jest ${split.node.join(' ')}`
          : stack.node.testRunner === 'mocha'
            ? `${nodeExecConfig.exec} mocha ${split.node.join(' ')}`
            : `${nodeExecConfig.run} test`;
      addUniqueCommand(merged, 'focused', {
        name: 'node-direct-tests',
        description: 'Run node direct affected tests',
        cmd: nodeDirectCmd,
      });
    }

    if (split.python.length > 0 && stack.python?.enabled && stack.python.testRunner === 'pytest') {
      addUniqueCommand(merged, 'focused', {
        name: 'python-direct-tests',
        description: 'Run python direct affected tests',
        cmd: `pytest ${split.python.join(' ')}`,
      });
    }

    if (split.go.length > 0 && stack.go?.enabled) {
      const goPackages = Array.from(new Set(
        split.go.map((file) => path.dirname(file)).filter((dir) => dir && dir !== '.')
      ));
      if (goPackages.length > 0) {
        addUniqueCommand(merged, 'focused', {
          name: 'go-direct-tests',
          description: 'Run go direct affected packages',
          cmd: `go test ${goPackages.map((p) => `./${p}`).join(' ')}`,
        });
      }
    }

    const rustFiles = split.rust.filter((file) => /\.rs$/.test(file));
    if (rustFiles.length > 0 && stack.rust?.enabled) {
      addUniqueCommand(merged, 'focused', {
        name: 'rust-direct-tests',
        description: 'Run rust direct affected tests',
        cmd: 'cargo test',
      });
    }

    const javaFiles = split.java.filter((file) => /\.java$/.test(file));
    if (javaFiles.length > 0 && stack.java?.enabled) {
      const javaCmd = stack.java.buildTool === 'maven'
        ? `${stack.java.buildCommand || 'mvn'} -q -Dtest=*Test test`
        : stack.java.buildTool === 'gradle'
          ? `${stack.java.buildCommand || 'gradle'} -q test --tests *Test`
          : null;
      if (javaCmd) {
        addUniqueCommand(merged, 'focused', {
          name: 'java-direct-tests',
          description: 'Run java direct affected tests',
          cmd: javaCmd,
        });
      }
    }
  }

  if (stack.profile === 'mixed') {
    if (!merged.full.some((entry) => entry.name === 'mixed-review')) {
      merged.full.unshift({
        name: 'mixed-review',
        description: 'Review all stack-side validation results together',
        cmd: 'echo "Review node/python/java/go/rust command output together before merge"',
      });
    }
  }

  return merged;
}

module.exports = {
  detectStack,
  generateCommands,
};
