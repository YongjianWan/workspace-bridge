/**
 * Command generation logic — generate concrete validation commands per stack.
 */
const path = require('path');
const { mapFileToGoModule } = require('./detect');

function nodeExec(packageManager) {
  if (packageManager === 'npm') return { run: 'npm run', exec: 'npx' };
  if (['pnpm', 'yarn', 'bun'].includes(packageManager)) {
    return { run: `${packageManager} run`, exec: `${packageManager} exec` };
  }
  return null;
}

function buildNodeTestCommand(runner, files, execConfig) {
  const fileArgs = files.join(' ');
  if (runner === 'vitest') return `${execConfig.exec} vitest run ${fileArgs}`;
  if (runner === 'jest') return `${execConfig.exec} jest ${fileArgs}`;
  if (runner === 'mocha') return `${execConfig.exec} mocha ${fileArgs}`;
  return `${execConfig.run} test`;
}

function buildGoModuleTestCommands(modules, files, namePrefix) {
  const hasNestedModules = modules && modules.some((m) => !m.root);
  if (!hasNestedModules) return [];
  const affectedModules = new Set();
  for (const file of files) {
    const mod = mapFileToGoModule(file, modules);
    if (mod) affectedModules.add(mod.dir);
  }
  const commands = [];
  for (const modDir of Array.from(affectedModules).sort()) {
    const cdPrefix = modDir === '.' ? '' : `cd ${modDir} && `;
    commands.push({
      name: `${namePrefix}-tests`,
      description: `Run affected Go module${modDir === '.' ? '' : ` in ${modDir}`}`,
      cmd: `${cdPrefix}go test ./...`,
    });
  }
  return commands;
}

function buildRustTestCommands(rustStack, rustFiles, namePrefix) {
  const moduleFilters = [];
  for (const file of rustFiles) {
    const modName = inferRustModuleName(file);
    if (modName) moduleFilters.push(modName);
  }
  const moduleArgs = moduleFilters.length > 0
    ? ' ' + Array.from(new Set(moduleFilters)).sort().join(' ')
    : '';

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
      return [{
        name: `${namePrefix}-tests`,
        description: 'Run affected workspace crates',
        cmd: `cargo test ${crateArgs}${moduleArgs}`,
      }];
    }
  } else if (moduleArgs) {
    return [{
      name: `${namePrefix}-tests`,
      description: 'Run affected Rust modules',
      cmd: `cargo test${moduleArgs}`,
    }];
  }
  return [];
}

function buildStackCommands(stack, changeType, builderFn, options = {}) {
  if (!stack?.enabled) return { smoke: [], focused: [], full: [] };
  const allowed = options.allowedChangeTypes || ['code', 'tests', 'config', 'scripts'];
  if (!allowed.includes(changeType)) {
    return { smoke: [], focused: [], full: [] };
  }
  const commands = { smoke: [], focused: [], full: [] };
  builderFn(commands);
  return commands;
}

function getNodeCommands(nodeStack, changeType, targets) {
  if (!nodeStack?.enabled) return { smoke: [], focused: [], full: [] };
  const exec = nodeExec(nodeStack.packageManager);
  if (!exec) return { smoke: [], focused: [], full: [] };

  // Only actual source files should be passed to linters/test runners.
  const targetList = Array.isArray(targets) ? targets : [];
  const codeTargets = targetList.filter((f) => /\.(js|jsx|ts|tsx|mjs|cjs)$/.test(f));
  const fileArgs = codeTargets.length > 0 ? codeTargets.join(' ') : '.';

  return buildStackCommands(nodeStack, changeType, (commands) => {
    if (nodeStack.linters.includes('eslint')) {
      commands.smoke.push({ name: 'node-lint', description: 'Run ESLint on changed files', cmd: `${exec.exec} eslint ${fileArgs}` });
    }
    if (nodeStack.typeChecker === 'tsc') {
      commands.smoke.push({ name: 'node-type-check', description: 'Run TypeScript type check', cmd: `${exec.exec} tsc --noEmit` });
    }
    if (nodeStack.testRunner) {
      const testCmd = buildNodeTestCommand(nodeStack.testRunner, codeTargets, exec);
      if (codeTargets.length > 0) {
        commands.focused.push({ name: 'node-focused-tests', description: 'Run node-side focused tests', cmd: testCmd });
      }
      commands.full.push({ name: 'node-all-tests', description: 'Run node-side full test suite', cmd: `${exec.run} test` });
    }
  });
}

function getPythonCommands(pythonStack, changeType, targets) {
  if (!pythonStack) return { smoke: [], focused: [], full: [] };
  const targetList = Array.isArray(targets) ? targets : [];
  const fileArgs = targetList.length > 0 ? targetList.join(' ') : '.';

  return buildStackCommands(pythonStack, changeType, (commands) => {
    if (pythonStack.linters.includes('ruff')) {
      commands.smoke.push({ name: 'python-lint', description: 'Run Ruff on changed files', cmd: `ruff check ${fileArgs}` });
    }
    if (pythonStack.typeChecker === 'pyright') {
      commands.smoke.push({ name: 'python-type-check', description: 'Run Pyright', cmd: 'pyright' });
    }
    if (pythonStack.testRunner === 'pytest') {
      if (targetList.length > 0) {
        commands.focused.push({ name: 'python-focused-tests', description: 'Run python-side focused tests', cmd: `pytest ${fileArgs}` });
      }
      commands.full.push({ name: 'python-all-tests', description: 'Run python-side full test suite', cmd: 'pytest' });
    }
    if (changeType === 'config' && pythonStack.framework === 'django') {
      commands.focused.push({ name: 'django-check', description: 'Run Django system checks', cmd: 'python manage.py check' });
    }
  });
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
  if (!javaStack) return { smoke: [], focused: [], full: [] };
  const hasJavaFiles = targets.some((file) => /\.java$/.test(file));
  const javaCmd = javaStack.buildCommand || (javaStack.buildTool === 'maven' ? 'mvn' : javaStack.buildTool === 'gradle' ? 'gradle' : null);
  if (!javaCmd) return { smoke: [], focused: [], full: [] };

  return buildStackCommands(javaStack, changeType, (commands) => {
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
      const hasModules = affectedModules.length > 0;
      const compileTasks = hasModules
        ? affectedModules.map((m) => `${m}:classes`).join(' ')
        : 'classes';
      const testTasks = hasModules
        ? affectedModules.map((m) => `${m}:test`).join(' ')
        : 'test';
      commands.smoke.push({ name: 'java-compile-check', description: 'Run Gradle compile check', cmd: `${javaCmd} -q ${compileTasks}` });
      if (hasJavaFiles) {
        commands.focused.push({ name: 'java-focused-tests', description: 'Run focused Gradle tests', cmd: `${javaCmd} -q ${testTasks} --tests *Test` });
      }
      commands.full.push({ name: 'java-all-tests', description: 'Run Java full test suite', cmd: `${javaCmd} -q test` });
      if (javaStack.linters.includes('checkstyle')) {
        const checkstyleTasks = hasModules
          ? affectedModules.flatMap((m) => [`${m}:checkstyleMain`, `${m}:checkstyleTest`]).join(' ')
          : 'checkstyleMain checkstyleTest';
        commands.smoke.push({
          name: 'java-checkstyle',
          description: 'Run Checkstyle',
          cmd: `${javaCmd} ${checkstyleTasks}`,
        });
      }
    }
    if (javaStack.linters.includes('checkstyle') && javaStack.buildTool === 'maven') {
      commands.smoke.push({
        name: 'java-checkstyle',
        description: 'Run Checkstyle',
        cmd: `${javaCmd} checkstyle:check`,
      });
    }
  });
}

function getGoCommands(goStack, changeType, targets) {
  if (!goStack) return { smoke: [], focused: [], full: [] };
  return buildStackCommands(goStack, changeType, (commands) => {
    commands.smoke.push({ name: 'go-build', description: 'Go build check', cmd: 'go build ./...' });
    commands.smoke.push({ name: 'go-vet', description: 'Run go vet for static analysis', cmd: 'go vet ./...' });
    if (targets.length > 0) {
      const nested = buildGoModuleTestCommands(goStack.modules, targets, 'go-focused');
      if (nested.length > 0) {
        commands.focused.push(...nested);
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
  }, { allowedChangeTypes: ['code', 'tests', 'config'] });
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
  if (!rustStack) return { smoke: [], focused: [], full: [] };
  return buildStackCommands(rustStack, changeType, (commands) => {
    commands.smoke.push({ name: 'rust-check', description: 'Rust check', cmd: 'cargo check' });
    commands.smoke.push({ name: 'rust-clippy', description: 'Run cargo clippy for linting', cmd: 'cargo clippy -- -D warnings' });

    const rustFiles = targets.filter((file) => /\.rs$/.test(file));
    if (rustFiles.length > 0) {
      for (const cmd of buildRustTestCommands(rustStack, rustFiles, 'rust-focused')) {
        commands.focused.push(cmd);
      }
    }

    commands.full.push({ name: 'rust-all-tests', description: 'Run all Rust tests', cmd: 'cargo test' });
  }, { allowedChangeTypes: ['code', 'tests', 'config'] });
}

function getCppCommands(cppStack, changeType, targets) {
  if (!cppStack) return { smoke: [], focused: [], full: [] };
  return buildStackCommands(cppStack, changeType, (commands) => {
    commands.smoke.push({ name: 'cpp-cmake-build', description: 'CMake build check', cmd: 'cmake --build build' });
    if (targets.length > 0) {
      commands.focused.push({ name: 'cpp-compile-check', description: 'Compile affected C/C++ files', cmd: 'cmake --build build --target all' });
    }
    commands.full.push({ name: 'cpp-all-tests', description: 'Run all C/C++ tests', cmd: 'ctest --test-dir build' });
  }, { allowedChangeTypes: ['code', 'tests', 'config'] });
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

const STACK_TARGET_PATTERNS = {
  node: /\.(js|jsx|ts|tsx|json|mjs|cjs)$/,
  python: /\.py$/,
  java: /\.java$|(^|\/)(pom\.xml|build\.gradle|build\.gradle\.kts)$/,
  go: /\.go$|(^|\/)go\.mod$/,
  rust: /\.rs$|(^|\/)Cargo\.toml$/,
  cpp: /\.(c|cpp|cc|h|hpp)$/,
};

function splitTargetsByStack(targets) {
  const list = Array.isArray(targets) ? targets : [];
  return {
    node: list.filter((file) => STACK_TARGET_PATTERNS.node.test(file)),
    python: list.filter((file) => STACK_TARGET_PATTERNS.python.test(file)),
    java: list.filter((file) => STACK_TARGET_PATTERNS.java.test(file)),
    go: list.filter((file) => STACK_TARGET_PATTERNS.go.test(file)),
    rust: list.filter((file) => STACK_TARGET_PATTERNS.rust.test(file)),
    cpp: list.filter((file) => STACK_TARGET_PATTERNS.cpp.test(file)),
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
  const cppCommands = getCppCommands(stack.cpp, changeType, split.cpp);
  const merged = mergeCommandSets(nodeCommands, pythonCommands, javaCommands, goCommands, rustCommands, cppCommands);

  // In mixed repos, suppress stack-specific smoke checks when that stack has no changed files.
  if (stack.profile === 'mixed') {
    const hasNode = split.node.length > 0;
    const hasPython = split.python.length > 0;
    const hasJava = split.java.length > 0;
    const hasGo = split.go.length > 0;
    const hasRust = split.rust.length > 0;
    const hasCpp = split.cpp.length > 0;

    merged.smoke = merged.smoke.filter((cmd) => {
      if (!hasNode && cmd.name.startsWith('node-')) return false;
      if (!hasPython && cmd.name.startsWith('python-')) return false;
      if (!hasJava && cmd.name.startsWith('java-')) return false;
      if (!hasGo && cmd.name.startsWith('go-')) return false;
      if (!hasRust && cmd.name.startsWith('rust-')) return false;
      if (!hasCpp && cmd.name.startsWith('cpp-')) return false;
      return true;
    });
  }

  // Prefer direct test targets from focused steps when available.
  const directTests = (steps || []).find((step) => step?.name === 'run-direct-tests')?.targets || [];
  if (directTests.length > 0) {
    const split = splitTargetsByStack(directTests);
    const nodeExecConfig = nodeExec(stack.node?.packageManager);

    if (split.node.length > 0 && stack.node?.enabled && nodeExecConfig) {
      const nodeDirectCmd = buildNodeTestCommand(stack.node.testRunner, split.node, nodeExecConfig);
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
      const nested = buildGoModuleTestCommands(stack.go.modules, split.go, 'go-direct');
      if (nested.length > 0) {
        for (const cmd of nested) addUniqueCommand(merged, 'focused', cmd);
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
      for (const cmd of buildRustTestCommands(stack.rust, rustFiles, 'rust-direct')) {
        addUniqueCommand(merged, 'focused', cmd);
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
  generateCommands,
  inferRustModuleName,
};
