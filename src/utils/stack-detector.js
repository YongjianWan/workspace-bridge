/**
 * Stack Detector - Detect project tech stack and generate concrete commands
 */
const fs = require('fs');
const path = require('path');
const { pathExists, readJsonSafe } = require('./path');

// 检测规则配置表：消除重复 pathExists 链
const STACK_MARKERS = {
  python: ['requirements.txt', 'pyproject.toml', 'manage.py'],
  node:   ['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb'],
  java:   ['pom.xml', 'build.gradle', 'build.gradle.kts'],
  go:     ['go.mod'],
  rust:   ['Cargo.toml'],
};

function hasStack(root, name) {
  const files = STACK_MARKERS[name];
  if (!files) return false;
  return files.some((f) => pathExists(path.join(root, f)));
}

const hasPythonProject = (root) => hasStack(root, 'python');
const hasNodeProject   = (root) => hasStack(root, 'node');
const hasJavaProject   = (root) => hasStack(root, 'java');
const hasRustProject   = (root) => hasStack(root, 'rust');

function hasGoProject(root) {
  if (pathExists(path.join(root, 'go.mod'))) return true;
  try {
    const entries = fs.readdirSync(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'vendor') continue;
      if (pathExists(path.join(root, entry.name, 'go.mod'))) return true;
    }
  } catch { /* ignore */ }
  return false;
}

function detectGoModules(root) {
  const modules = [];
  if (pathExists(path.join(root, 'go.mod'))) {
    modules.push({ dir: '.', root: true });
  }
  try {
    const entries = fs.readdirSync(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'vendor') continue;
      if (pathExists(path.join(root, entry.name, 'go.mod'))) {
        modules.push({ dir: entry.name, root: false });
      }
    }
  } catch { /* ignore */ }
  return modules.length > 0 ? modules : null;
}

function mapFileToGoModule(file, modules) {
  const normalized = file.replace(/\\/g, '/');
  const sorted = [...modules].sort((a, b) => b.dir.length - a.dir.length);
  for (const mod of sorted) {
    if (mod.dir === '.') {
      const belongsToOther = sorted.some((m) => m.dir !== '.' && normalized.startsWith(m.dir + '/'));
      if (!belongsToOther) return mod;
    } else if (normalized === mod.dir || normalized.startsWith(mod.dir + '/')) {
      return mod;
    }
  }
  return null;
}

function extractTomlStringArray(content, key) {
  const lines = content.split('\n');
  let buffer = '';
  let inArray = false;
  for (const line of lines) {
    if (!inArray) {
      const match = line.match(new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`));
      if (match) {
        buffer = match[1];
        inArray = true;
        if (buffer.includes(']')) break;
      }
    } else {
      buffer += '\n' + line;
      if (line.includes(']')) break;
    }
  }
  if (!buffer) return null;
  const items = [];
  const stringRe = /["']([^"']+)["']/g;
  let m;
  while ((m = stringRe.exec(buffer)) !== null) {
    items.push(m[1]);
  }
  return items.length > 0 ? items : null;
}

function detectRustWorkspaceMembers(root) {
  const cargoPath = path.join(root, 'Cargo.toml');
  if (!pathExists(cargoPath)) return null;

  const content = fs.readFileSync(cargoPath, 'utf8');
  if (!content.includes('[workspace]')) return null;

  const members = extractTomlStringArray(content, 'members');
  if (!members) return null;

  const crates = [];
  for (const member of members) {
    const memberCargo = path.join(root, member, 'Cargo.toml');
    if (!pathExists(memberCargo)) continue;
    const memberContent = fs.readFileSync(memberCargo, 'utf8');
    const nameMatch = memberContent.match(/name\s*=\s*["']([^"']+)["']/);
    if (nameMatch) {
      crates.push({ dir: member.replace(/\\/g, '/'), name: nameMatch[1] });
    }
  }
  return crates.length > 0 ? crates : null;
}

function detectJavaBuildTool(root) {
  if (pathExists(path.join(root, 'pom.xml'))) return 'maven';
  if (pathExists(path.join(root, 'build.gradle')) || pathExists(path.join(root, 'build.gradle.kts'))) return 'gradle';
  return null;
}

function detectGradleSubprojects(root) {
  const settingsFiles = ['settings.gradle', 'settings.gradle.kts'];
  for (const file of settingsFiles) {
    const filePath = path.join(root, file);
    if (!pathExists(filePath)) continue;
    const content = readTextIfExists(filePath);
    if (!content) continue;
    const modules = [];
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('include')) continue;
      if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;
      const quotes = /["']([^"']+)["']/g;
      let m;
      while ((m = quotes.exec(trimmed)) !== null) {
        modules.push(m[1]);
      }
    }
    if (modules.length === 0) return null;
    return modules.map((name) => ({
      name: ':' + name,
      dir: name.replace(/:/g, '/'),
    }));
  }
  return null;
}

const JAVA_BUILD_RULES = {
  maven:  { wrappers: [{ file: 'mvnw.cmd', cmd: 'mvnw.cmd' }, { file: 'mvnw', cmd: './mvnw' }], default: 'mvn' },
  gradle: { wrappers: [{ file: 'gradlew.bat', cmd: 'gradlew.bat' }, { file: 'gradlew', cmd: './gradlew' }], default: 'gradle' },
};

function detectJavaBuildCommand(root, buildTool) {
  const rule = JAVA_BUILD_RULES[buildTool];
  if (!rule) return null;
  for (const wrapper of rule.wrappers) {
    if (pathExists(path.join(root, wrapper.file))) return wrapper.cmd;
  }
  return rule.default;
}

const PACKAGE_MANAGER_RULES = [
  { name: 'pnpm', files: ['pnpm-lock.yaml'] },
  { name: 'yarn', files: ['yarn.lock'] },
  { name: 'bun', files: ['bun.lockb', 'bun.lock'] },
  { name: 'npm', files: ['package-lock.json', 'package.json'] },
];

function detectNodePackageManager(root) {
  for (const rule of PACKAGE_MANAGER_RULES) {
    if (rule.files.some((f) => pathExists(path.join(root, f)))) {
      return rule.name;
    }
  }
  return null;
}

const TEST_RUNNER_FILE_RULES = [
  { name: 'jest',    type: 'node',   files: ['jest.config.js', 'jest.config.ts', 'jest.config.mjs'] },
  { name: 'vitest',  type: 'node',   files: ['vitest.config.ts', 'vitest.config.js', 'vitest.config.mjs'] },
  { name: 'mocha',   type: 'node',   files: ['.mocharc.js', '.mocharc.yml', '.mocharc.json'] },
  { name: 'pytest',  type: 'python', files: ['pytest.ini', 'setup.cfg', 'pyproject.toml'] },
];

function detectTestRunner(root) {
  for (const rule of TEST_RUNNER_FILE_RULES) {
    if (rule.files.some((f) => pathExists(path.join(root, f)))) {
      return { name: rule.name, type: rule.type };
    }
  }

  const packageJsonPath = path.join(root, 'package.json');
  if (pathExists(packageJsonPath)) {
    const pkg = readJsonSafe(packageJsonPath);
    const scripts = pkg?.scripts || {};
    const testScript = scripts.test || '';
    if (testScript.includes('jest')) return { name: 'jest', type: 'node' };
    if (testScript.includes('vitest')) return { name: 'vitest', type: 'node' };
    if (testScript.includes('mocha')) return { name: 'mocha', type: 'node' };
    const hasTestScript = Object.keys(scripts).some((key) => key === 'test' || key.startsWith('test:'));
    if (hasTestScript) {
      return { name: 'custom', type: 'node' };
    }
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

const LINTER_FILE_RULES = [
  { stack: 'node', name: 'eslint', files: ['.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', 'eslint.config.js'] },
  { stack: 'node', name: 'prettier', files: ['.prettierrc', '.prettierrc.json', 'prettier.config.js'] },
  { stack: 'java', name: 'checkstyle', files: ['checkstyle.xml', 'config/checkstyle/checkstyle.xml'] },
];

function hasGradlePlugin(text, pluginName) {
  if (!text) return false;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;
    if (new RegExp(`\\b${pluginName}\\b`).test(trimmed)) return true;
  }
  return false;
}

function detectLinters(root, pyprojectText = '') {
  const linters = { node: [], python: [], java: [] };

  for (const rule of LINTER_FILE_RULES) {
    if (rule.files.some((f) => pathExists(path.join(root, f)))) {
      linters[rule.stack].push(rule.name);
    }
  }

  if (pyprojectText && (pyprojectText.includes('ruff') || pyprojectText.includes('[tool.ruff]'))) {
    linters.python.push('ruff');
  }

  const gradleText = readTextIfExists(path.join(root, 'build.gradle')) +
    readTextIfExists(path.join(root, 'build.gradle.kts'));
  const pomText = readTextIfExists(path.join(root, 'pom.xml'));
  if (hasGradlePlugin(gradleText, 'spotbugs') || /\bspotbugs\b/.test(pomText)) linters.java.push('spotbugs');
  if (hasGradlePlugin(gradleText, 'pmd') || /\bpmd\b/.test(pomText)) linters.java.push('pmd');
  if (hasGradlePlugin(gradleText, 'errorprone') || /\berrorprone\b/.test(pomText)) linters.java.push('errorprone');
  if (hasGradlePlugin(gradleText, 'jacoco') || /\bjacoco\b/.test(pomText)) linters.java.push('jacoco');

  return linters;
}

const TYPE_CHECKER_FILE_RULES = [
  { stack: 'node', name: 'tsc', files: ['tsconfig.json'] },
];

function detectTypeCheckers(root, pyprojectText = '') {
  const typeCheckers = { node: null, python: null, java: null };

  for (const rule of TYPE_CHECKER_FILE_RULES) {
    if (rule.files.some((f) => pathExists(path.join(root, f)))) {
      typeCheckers[rule.stack] = rule.name;
    }
  }
  if (pyprojectText && (pyprojectText.includes('pyright') || pyprojectText.includes('[tool.pyright]'))) {
    typeCheckers.python = 'pyright';
  }

  return typeCheckers;
}

const DOCS_TOOL_RULES = [
  { name: 'mkdocs', files: ['mkdocs.yml'] },
  { name: 'docusaurus', files: ['docusaurus.config.js'] },
  { name: 'vitepress', files: ['vitepress.config.js'] },
];

function detectDocsTool(root) {
  for (const rule of DOCS_TOOL_RULES) {
    if (rule.files.some((f) => pathExists(path.join(root, f)))) {
      return rule.name;
    }
  }
  return null;
}

function detectStack(root) {
  const pyprojectText = readTextIfExists(path.join(root, 'pyproject.toml'));
  const hasNode = hasNodeProject(root);
  const hasPython = hasPythonProject(root);
  const hasJava = hasJavaProject(root);
  const hasGo = hasGoProject(root);
  const hasRust = hasRustProject(root);
  const goModules = hasGo ? detectGoModules(root) : null;
  const nodePackageManager = detectNodePackageManager(root);
  const javaBuildTool = detectJavaBuildTool(root);
  const javaBuildCommand = detectJavaBuildCommand(root, javaBuildTool);
  const javaSubprojects = javaBuildTool === 'gradle' ? detectGradleSubprojects(root) : null;
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
      subprojects: javaSubprojects,
    } : null,
    go: hasGo ? { enabled: true, packageManager: 'go modules', testRunner: 'go test', modules: goModules } : null,
    rust: hasRust ? { enabled: true, packageManager: 'cargo', testRunner: 'cargo test', workspaceMembers: detectRustWorkspaceMembers(root) } : null,
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

  // Only actual source files should be passed to linters/test runners.
  const codeTargets = targets.filter((f) => /\.(js|jsx|ts|tsx|mjs|cjs)$/.test(f));
  const fileArgs = codeTargets.length > 0 ? codeTargets.join(' ') : '.';
  const commands = { smoke: [], focused: [], full: [] };

  if (changeType === 'code' || changeType === 'tests' || changeType === 'config' || changeType === 'scripts') {
    if (nodeStack.linters.includes('eslint')) {
      commands.smoke.push({ name: 'node-lint', description: 'Run ESLint on changed files', cmd: `${exec.exec} eslint ${fileArgs}` });
    }
    if (nodeStack.typeChecker === 'tsc') {
      commands.smoke.push({ name: 'node-type-check', description: 'Run TypeScript type check', cmd: `${exec.exec} tsc --noEmit` });
    }
    if (nodeStack.testRunner) {
      const testCmd = nodeStack.testRunner === 'vitest'
        ? `${exec.exec} vitest run ${codeTargets.join(' ')}`
        : nodeStack.testRunner === 'jest'
          ? `${exec.exec} jest ${codeTargets.join(' ')}`
          : nodeStack.testRunner === 'mocha'
            ? `${exec.exec} mocha ${codeTargets.join(' ')}`
          : `${exec.run} test`;
      if (codeTargets.length > 0) {
        commands.focused.push({ name: 'node-focused-tests', description: 'Run node-side focused tests', cmd: testCmd });
      }
    }
    commands.full.push({ name: 'node-all-tests', description: 'Run node-side full test suite', cmd: `${exec.run} test` });
  }

  return commands;
}

function getPythonCommands(pythonStack, changeType, targets) {
  if (!pythonStack?.enabled) return { smoke: [], focused: [], full: [] };
  if (changeType !== 'code' && changeType !== 'tests' && changeType !== 'config' && changeType !== 'scripts') {
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

function mapJavaFilesToGradleModules(files, subprojects) {
  const modules = new Set();
  for (const file of files) {
    const normalized = file.replace(/\\/g, '/');
    for (const proj of subprojects) {
      const prefix = proj.dir + '/';
      if (normalized === proj.dir || normalized.startsWith(prefix)) {
        modules.add(proj.name);
        break;
      }
    }
  }
  return Array.from(modules).sort();
}

function getJavaCommands(javaStack, changeType, targets) {
  if (!javaStack?.enabled) return { smoke: [], focused: [], full: [] };
  if (changeType !== 'code' && changeType !== 'tests' && changeType !== 'config' && changeType !== 'scripts') {
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
    const affectedModules = (javaStack.subprojects && hasJavaFiles)
      ? mapJavaFilesToGradleModules(targets, javaStack.subprojects)
      : [];
    if (affectedModules.length > 0) {
      const compileTasks = affectedModules.map((m) => `${m}:classes`).join(' ');
      const testTasks = affectedModules.map((m) => `${m}:test`).join(' ');
      commands.smoke.push({ name: 'java-compile-check', description: 'Run Gradle compile check', cmd: `${javaCmd} -q ${compileTasks}` });
      commands.focused.push({ name: 'java-focused-tests', description: 'Run focused Gradle tests', cmd: `${javaCmd} -q ${testTasks} --tests *Test` });
      commands.full.push({ name: 'java-all-tests', description: 'Run Java full test suite', cmd: `${javaCmd} -q test` });
      if (javaStack.linters.includes('checkstyle')) {
        const checkstyleTasks = affectedModules.flatMap((m) => [`${m}:checkstyleMain`, `${m}:checkstyleTest`]).join(' ');
        commands.smoke.push({
          name: 'java-checkstyle',
          description: 'Run Checkstyle',
          cmd: `${javaCmd} ${checkstyleTasks}`,
        });
      }
    } else {
      commands.smoke.push({ name: 'java-compile-check', description: 'Run Gradle compile check', cmd: `${javaCmd} -q classes` });
      if (hasJavaFiles) {
        commands.focused.push({ name: 'java-focused-tests', description: 'Run focused Gradle tests', cmd: `${javaCmd} -q test --tests *Test` });
      }
      commands.full.push({ name: 'java-all-tests', description: 'Run Java full test suite', cmd: `${javaCmd} -q test` });
      if (javaStack.linters.includes('checkstyle')) {
        commands.smoke.push({
          name: 'java-checkstyle',
          description: 'Run Checkstyle',
          cmd: `${javaCmd} checkstyleMain checkstyleTest`,
        });
      }
    }
  }
  if (javaStack.linters.includes('checkstyle') && javaStack.buildTool === 'maven') {
    commands.smoke.push({
      name: 'java-checkstyle',
      description: 'Run Checkstyle',
      cmd: `${javaCmd} checkstyle:check`,
    });
  }
  return commands;
}

function getGoCommands(goStack, changeType, targets) {
  if (!goStack?.enabled) return { smoke: [], focused: [], full: [] };
  if (changeType !== 'code' && changeType !== 'tests' && changeType !== 'config') return { smoke: [], focused: [], full: [] };
  const commands = { smoke: [], focused: [], full: [] };
  commands.smoke.push({ name: 'go-build', description: 'Go build check', cmd: 'go build ./...' });
  if (targets.length > 0) {
    const hasNestedModules = goStack.modules && goStack.modules.some((m) => !m.root);
    if (hasNestedModules) {
      const affectedModules = new Set();
      for (const file of targets) {
        const mod = mapFileToGoModule(file, goStack.modules);
        if (mod) affectedModules.add(mod.dir);
      }
      for (const modDir of Array.from(affectedModules).sort()) {
        const cdPrefix = modDir === '.' ? '' : `cd ${modDir} && `;
        commands.focused.push({
          name: 'go-focused-tests',
          description: `Run affected Go module${modDir === '.' ? '' : ` in ${modDir}`}`,
          cmd: `${cdPrefix}go test ./...`,
        });
      }
    } else {
      const goPackages = Array.from(new Set(
        targets.map((file) => path.dirname(file)).filter((dir) => dir && dir !== '.')
      ));
      if (goPackages.length > 0) {
        commands.focused.push({ name: 'go-focused-tests', description: 'Run affected Go packages', cmd: `go test ${goPackages.map((p) => `./${p}`).join(' ')}` });
      }
    }
  }
  commands.full.push({ name: 'go-all-tests', description: 'Run all Go tests', cmd: 'go test ./...' });
  return commands;
}

function inferRustModuleName(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  if (normalized.includes('/tests/') || normalized.includes('/benches/') || normalized.includes('/examples/')) return null;
  const srcMatch = normalized.match(/(?:^|\/)src\/(.+?)\.rs$/);
  if (!srcMatch) return null;
  const relativePath = srcMatch[1];
  if (relativePath === 'lib' || relativePath === 'main' || relativePath === 'mod') return null;
  const parts = relativePath.split('/');
  if (parts[parts.length - 1] === 'mod') {
    parts.pop();
  }
  if (parts.length === 0) return null;
  return parts.join('::');
}

function getRustCommands(rustStack, changeType, targets) {
  if (!rustStack?.enabled) return { smoke: [], focused: [], full: [] };
  if (changeType !== 'code' && changeType !== 'tests' && changeType !== 'config') return { smoke: [], focused: [], full: [] };
  const commands = { smoke: [], focused: [], full: [] };
  commands.smoke.push({ name: 'rust-check', description: 'Rust check', cmd: 'cargo check' });

  const rustFiles = targets.filter((file) => /\.rs$/.test(file));
  if (rustFiles.length > 0) {
    const moduleFilters = [];
    for (const file of rustFiles) {
      const modName = inferRustModuleName(file);
      if (modName) moduleFilters.push(modName);
    }
    const moduleArgs = moduleFilters.length > 0 ? ' ' + Array.from(new Set(moduleFilters)).sort().join(' ') : '';

    if (rustStack.workspaceMembers) {
      const affectedCrates = new Set();
      for (const file of rustFiles) {
        const normalizedFile = file.replace(/\\/g, '/');
        for (const crate of rustStack.workspaceMembers) {
          const prefix = crate.dir + '/';
          if (normalizedFile === crate.dir || normalizedFile.startsWith(prefix)) {
            affectedCrates.add(crate.name);
          }
        }
      }
      if (affectedCrates.size > 0) {
        const crateArgs = Array.from(affectedCrates).sort().map((name) => `-p ${name}`).join(' ');
        commands.focused.push({ name: 'rust-focused-tests', description: 'Run affected workspace crates', cmd: `cargo test ${crateArgs}${moduleArgs}` });
      }
    } else if (moduleArgs) {
      commands.focused.push({ name: 'rust-focused-tests', description: 'Run affected Rust modules', cmd: `cargo test${moduleArgs}` });
    }
  }

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

  const split = splitTargetsByStack(targets);

  const nodeCommands = getNodeCommands(stack.node, changeType, split.node);
  const pythonCommands = getPythonCommands(stack.python, changeType, split.python);
  const javaCommands = getJavaCommands(stack.java, changeType, split.java);
  const goCommands = getGoCommands(stack.go, changeType, split.go);
  const rustCommands = getRustCommands(stack.rust, changeType, split.rust);
  const merged = mergeCommandSets(nodeCommands, pythonCommands, javaCommands, goCommands, rustCommands);

  // In mixed repos, suppress stack-specific smoke checks when that stack has no changed files.
  if (stack.profile === 'mixed') {
    const hasNode = split.node.length > 0;
    const hasPython = split.python.length > 0;
    const hasJava = split.java.length > 0;
    const hasGo = split.go.length > 0;
    const hasRust = split.rust.length > 0;

    merged.smoke = merged.smoke.filter((cmd) => {
      if (!hasNode && cmd.name.startsWith('node-')) return false;
      if (!hasPython && cmd.name.startsWith('python-')) return false;
      if (!hasJava && cmd.name.startsWith('java-')) return false;
      if (!hasGo && cmd.name.startsWith('go-')) return false;
      if (!hasRust && cmd.name.startsWith('rust-')) return false;
      return true;
    });
  }

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
      const hasNestedModules = stack.go.modules && stack.go.modules.some((m) => !m.root);
      if (hasNestedModules) {
        const affectedModules = new Set();
        for (const file of split.go) {
          const mod = mapFileToGoModule(file, stack.go.modules);
          if (mod) affectedModules.add(mod.dir);
        }
        for (const modDir of Array.from(affectedModules).sort()) {
          const cdPrefix = modDir === '.' ? '' : `cd ${modDir} && `;
          addUniqueCommand(merged, 'focused', {
            name: 'go-direct-tests',
            description: `Run go direct affected module${modDir === '.' ? '' : ` in ${modDir}`}`,
            cmd: `${cdPrefix}go test ./...`,
          });
        }
      } else {
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
    }

    const rustFiles = split.rust.filter((file) => /\.rs$/.test(file));
    if (rustFiles.length > 0 && stack.rust?.enabled) {
      const moduleFilters = [];
      for (const file of rustFiles) {
        const modName = inferRustModuleName(file);
        if (modName) moduleFilters.push(modName);
      }
      const moduleArgs = moduleFilters.length > 0 ? ' ' + Array.from(new Set(moduleFilters)).sort().join(' ') : '';

      if (stack.rust.workspaceMembers) {
        const affectedCrates = new Set();
        for (const file of rustFiles) {
          const normalizedFile = file.replace(/\\/g, '/');
          for (const crate of stack.rust.workspaceMembers) {
            const prefix = crate.dir + '/';
            if (normalizedFile === crate.dir || normalizedFile.startsWith(prefix)) {
              affectedCrates.add(crate.name);
            }
          }
        }
        if (affectedCrates.size > 0) {
          const crateArgs = Array.from(affectedCrates).sort().map((name) => `-p ${name}`).join(' ');
          addUniqueCommand(merged, 'focused', {
            name: 'rust-direct-tests',
            description: 'Run rust direct affected workspace crates',
            cmd: `cargo test ${crateArgs}${moduleArgs}`,
          });
        }
      } else if (moduleArgs) {
        addUniqueCommand(merged, 'focused', {
          name: 'rust-direct-tests',
          description: 'Run rust direct affected modules',
          cmd: `cargo test${moduleArgs}`,
        });
      }
    }

    const javaFiles = split.java.filter((file) => /\.java$/.test(file));
    if (javaFiles.length > 0 && stack.java?.enabled) {
      let javaCmd = null;
      if (stack.java.buildTool === 'maven') {
        javaCmd = `${stack.java.buildCommand || 'mvn'} -q -Dtest=*Test test`;
      } else if (stack.java.buildTool === 'gradle') {
        const affectedModules = stack.java.subprojects
          ? mapJavaFilesToGradleModules(javaFiles, stack.java.subprojects)
          : [];
        if (affectedModules.length > 0) {
          const testTasks = affectedModules.map((m) => `${m}:test`).join(' ');
          javaCmd = `${stack.java.buildCommand || 'gradle'} -q ${testTasks} --tests *Test`;
        } else {
          javaCmd = `${stack.java.buildCommand || 'gradle'} -q test --tests *Test`;
        }
      }
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
  detectNodePackageManager,
  detectTestRunner,
  inferRustModuleName,
};
