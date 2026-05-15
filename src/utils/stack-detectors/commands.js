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
  if (runner === 'vitest') return { command: execConfig.exec, args: ['vitest', 'run', ...files] };
  if (runner === 'jest') return { command: execConfig.exec, args: ['jest', ...files] };
  if (runner === 'mocha') return { command: execConfig.exec, args: ['mocha', ...files] };
  const runParts = execConfig.run.split(/\s+/);
  return { command: runParts[0], args: [...runParts.slice(1), 'test'] };
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
    commands.push({
      name: `${namePrefix}-tests`,
      description: `Run affected Go module${modDir === '.' ? '' : ` in ${modDir}`}`,
      executable: { command: 'go', args: ['test', './...'], cwd: modDir === '.' ? null : modDir },
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
    ? Array.from(new Set(moduleFilters)).sort()
    : [];

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
      const crateArgs = Array.from(affectedCrates).sort().flatMap((name) => ['-p', name]);
      return [{
        name: `${namePrefix}-tests`,
        description: 'Run affected workspace crates',
        executable: { command: 'cargo', args: ['test', ...crateArgs, ...moduleArgs] },
      }];
    }
  } else if (moduleArgs.length > 0) {
    return [{
      name: `${namePrefix}-tests`,
      description: 'Run affected Rust modules',
      executable: { command: 'cargo', args: ['test', ...moduleArgs] },
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
      commands.smoke.push({ name: 'node-lint', description: 'Run ESLint on changed files', executable: { command: exec.exec, args: ['eslint', ...codeTargets] } });
    }
    if (nodeStack.typeChecker === 'tsc') {
      commands.smoke.push({ name: 'node-type-check', description: 'Run TypeScript type check', executable: { command: exec.exec, args: ['tsc', '--noEmit'] } });
    }
    if (nodeStack.testRunner) {
      const testExec = buildNodeTestCommand(nodeStack.testRunner, codeTargets, exec);
      if (codeTargets.length > 0) {
        commands.focused.push({ name: 'node-focused-tests', description: 'Run node-side focused tests', executable: testExec });
      }
      commands.full.push({ name: 'node-all-tests', description: 'Run node-side full test suite', executable: { command: exec.run.split(/\s+/)[0], args: [...exec.run.split(/\s+/).slice(1), 'test'] } });
    }
  });
}

function getPythonCommands(pythonStack, changeType, targets) {
  if (!pythonStack) return { smoke: [], focused: [], full: [] };
  const targetList = Array.isArray(targets) ? targets : [];
  const fileArgs = targetList.length > 0 ? targetList.join(' ') : '.';

  return buildStackCommands(pythonStack, changeType, (commands) => {
    if (pythonStack.linters.includes('ruff')) {
      commands.smoke.push({ name: 'python-lint', description: 'Run Ruff on changed files', executable: { command: 'ruff', args: ['check', ...targetList] } });
    }
    if (pythonStack.typeChecker === 'pyright') {
      commands.smoke.push({ name: 'python-type-check', description: 'Run Pyright', executable: { command: 'pyright', args: [] } });
    }
    if (pythonStack.testRunner === 'pytest') {
      if (targetList.length > 0) {
        commands.focused.push({ name: 'python-focused-tests', description: 'Run python-side focused tests', executable: { command: 'pytest', args: targetList } });
      }
      commands.full.push({ name: 'python-all-tests', description: 'Run python-side full test suite', executable: { command: 'pytest', args: [] } });
    }
    if (changeType === 'config' && pythonStack.framework === 'django') {
      commands.focused.push({ name: 'django-check', description: 'Run Django system checks', executable: { command: 'python', args: ['manage.py', 'check'] } });
    }
  });
}

function mapJavaFilesToModules(files, modules) {
  const affected = new Set();
  for (const file of files) {
    const normalized = file.replace(/\\/g, '/');
    for (const mod of modules) {
      const prefix = mod.dir + '/';
      if (normalized === mod.dir || normalized.startsWith(prefix)) {
        affected.add(mod.name);
        break;
      }
    }
  }
  return Array.from(affected).sort();
}

function getJavaCommands(javaStack, changeType, targets) {
  if (!javaStack) return { smoke: [], focused: [], full: [] };
  const hasJavaFiles = targets.some((file) => /\.java$/.test(file));
  const javaCmd = javaStack.buildCommand || (javaStack.buildTool === 'maven' ? 'mvn' : javaStack.buildTool === 'gradle' ? 'gradle' : null);
  if (!javaCmd) return { smoke: [], focused: [], full: [] };

  return buildStackCommands(javaStack, changeType, (commands) => {
    if (javaStack.buildTool === 'maven') {
      const modules = javaStack.modules || javaStack.subprojects;
      const affectedModules = (modules && hasJavaFiles)
        ? mapJavaFilesToModules(targets, modules)
        : [];
      const hasModules = affectedModules.length > 0;
      const plArg = hasModules ? affectedModules.join(',') : '';

      commands.smoke.push({
        name: 'java-compile-check',
        description: 'Run Maven compile check',
        executable: hasModules
          ? { command: javaCmd, args: ['-pl', plArg, '-am', '-q', '-DskipTests', 'compile'] }
          : { command: javaCmd, args: ['-q', '-DskipTests', 'compile'] },
      });

      if (hasJavaFiles) {
        commands.focused.push({
          name: 'java-focused-tests',
          description: 'Run focused Maven tests',
          executable: hasModules
            ? { command: javaCmd, args: ['-pl', plArg, '-am', '-q', '-Dtest=*Test', 'test'] }
            : { command: javaCmd, args: ['-q', '-Dtest=*Test', 'test'] },
        });
      }

      commands.full.push({
        name: 'java-all-tests',
        description: 'Run Java full test suite',
        executable: hasModules
          ? { command: javaCmd, args: ['-pl', plArg, '-am', '-q', 'test'] }
          : { command: javaCmd, args: ['-q', 'test'] },
      });
    } else if (javaStack.buildTool === 'gradle') {
      const modules = javaStack.modules || javaStack.subprojects;
      const affectedModules = (modules && hasJavaFiles)
        ? mapJavaFilesToModules(targets, modules)
        : [];
      const hasModules = affectedModules.length > 0;
      const compileTasks = hasModules
        ? affectedModules.flatMap((m) => [`${m}:classes`])
        : ['classes'];
      const testTasks = hasModules
        ? affectedModules.flatMap((m) => [`${m}:test`])
        : ['test'];
      commands.smoke.push({
        name: 'java-compile-check',
        description: 'Run Gradle compile check',
        executable: { command: javaCmd, args: ['-q', ...compileTasks] },
      });
      if (hasJavaFiles) {
        commands.focused.push({
          name: 'java-focused-tests',
          description: 'Run focused Gradle tests',
          executable: { command: javaCmd, args: ['-q', ...testTasks, '--tests', '*Test'] },
        });
      }
      commands.full.push({
        name: 'java-all-tests',
        description: 'Run Java full test suite',
        executable: { command: javaCmd, args: ['-q', 'test'] },
      });
      if (javaStack.linters.includes('checkstyle')) {
        const checkstyleTasks = hasModules
          ? affectedModules.flatMap((m) => [`${m}:checkstyleMain`, `${m}:checkstyleTest`])
          : ['checkstyleMain', 'checkstyleTest'];
        commands.smoke.push({
          name: 'java-checkstyle',
          description: 'Run Checkstyle',
          executable: { command: javaCmd, args: checkstyleTasks },
        });
      }
    }
    if (javaStack.linters.includes('checkstyle') && javaStack.buildTool === 'maven') {
      commands.smoke.push({
        name: 'java-checkstyle',
        description: 'Run Checkstyle',
        executable: { command: javaCmd, args: ['checkstyle:check'] },
      });
    }
  });
}

function getGoCommands(goStack, changeType, targets) {
  if (!goStack) return { smoke: [], focused: [], full: [] };
  return buildStackCommands(goStack, changeType, (commands) => {
    commands.smoke.push({ name: 'go-build', description: 'Go build check', executable: { command: 'go', args: ['build', './...'] } });
    commands.smoke.push({ name: 'go-vet', description: 'Run go vet for static analysis', executable: { command: 'go', args: ['vet', './...'] } });
    if (targets.length > 0) {
      const nested = buildGoModuleTestCommands(goStack.modules, targets, 'go-focused');
      if (nested.length > 0) {
        commands.focused.push(...nested);
      } else {
        const goPackages = Array.from(new Set(
          targets.map((file) => path.dirname(file)).filter((dir) => dir && dir !== '.')
        ));
        if (goPackages.length > 0) {
          commands.focused.push({ name: 'go-focused-tests', description: 'Run affected Go packages', executable: { command: 'go', args: ['test', ...goPackages.map((p) => `./${p}`)] } });
        }
      }
    }
    commands.full.push({ name: 'go-all-tests', description: 'Run all Go tests', executable: { command: 'go', args: ['test', './...'] } });
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
    commands.smoke.push({ name: 'rust-check', description: 'Rust check', executable: { command: 'cargo', args: ['check'] } });
    commands.smoke.push({ name: 'rust-clippy', description: 'Run cargo clippy for linting', executable: { command: 'cargo', args: ['clippy', '--', '-D', 'warnings'] } });

    const rustFiles = targets.filter((file) => /\.rs$/.test(file));
    if (rustFiles.length > 0) {
      for (const cmd of buildRustTestCommands(rustStack, rustFiles, 'rust-focused')) {
        commands.focused.push(cmd);
      }
    }

    commands.full.push({ name: 'rust-all-tests', description: 'Run all Rust tests', executable: { command: 'cargo', args: ['test'] } });
  }, { allowedChangeTypes: ['code', 'tests', 'config'] });
}

function getCppCommands(cppStack, changeType, targets) {
  if (!cppStack) return { smoke: [], focused: [], full: [] };
  return buildStackCommands(cppStack, changeType, (commands) => {
    commands.smoke.push({ name: 'cpp-cmake-build', description: 'CMake build check', executable: { command: 'cmake', args: ['--build', 'build'] } });
    if (targets.length > 0) {
      commands.focused.push({ name: 'cpp-compile-check', description: 'Compile affected C/C++ files', executable: { command: 'cmake', args: ['--build', 'build', '--target', 'all'] } });
    }
    commands.full.push({ name: 'cpp-all-tests', description: 'Run all C/C++ tests', executable: { command: 'ctest', args: ['--test-dir', 'build'] } });
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
  if (!entry?.cmd && !entry?.executable) return;
  const exists = commands[phase].some((item) => {
    if (item.name === entry.name) return true;
    if (entry.cmd && item.cmd === entry.cmd) return true;
    if (entry.executable && item.executable) {
      return JSON.stringify(item.executable) === JSON.stringify(entry.executable);
    }
    return false;
  });
  if (!exists) commands[phase].push(entry);
}

// P8-2-1: render a structured executable object back into a human-readable cmd string.
function renderCommandString(executable, platform = process.platform) {
  if (!executable) return '';
  const { command, args, cwd, shell } = executable;
  if (shell) return shell;
  const parts = [command, ...(args || [])].filter((s) => s !== null && s !== undefined);
  const body = parts.join(' ');
  if (!cwd) return body;
  if (platform === 'win32') {
    return `pushd ${cwd} && ${body}`;
  }
  return `cd ${cwd} && ${body}`;
}

// P8-2: parse a raw cmd string into a structured executable object.
// Best-effort: extracts cd prefixes, detects shell operators, splits args.
function parseCommandString(cmd) {
  if (!cmd || typeof cmd !== 'string') {
    return { command: null, args: [], cwd: null, shell: null, expectedExitCode: 0, onFailure: 'abort' };
  }

  let cwd = null;
  let rest = cmd;

  // Extract cd/pushd prefix: "cd <path> && ", "cd <path> ; ", "pushd <path> && "
  const cdMatch = rest.match(/^(?:(?:cd|pushd)\s+(.+?)\s+(?:&&|;)\s+)(.+)$/s);
  if (cdMatch) {
    cwd = cdMatch[1];
    rest = cdMatch[2];
  }

  // If still contains shell operators, mark as shell-required
  const hasShellOps = /[|&;<>()]/.test(rest);

  // Naive split (doesn't handle quotes perfectly, but good enough for CLI args)
  const parts = rest.trim().split(/\s+/).filter(Boolean);
  const command = parts[0] || null;
  const args = parts.slice(1);

  return {
    command,
    args,
    cwd,
    shell: hasShellOps ? cmd : null,
    expectedExitCode: 0,
    onFailure: 'abort',
  };
}

function enrichCommandEntry(entry) {
  if (!entry || typeof entry !== 'object') return entry;
  // Bidirectional: executable → cmd, or cmd → executable
  if (entry.executable && !entry.cmd) {
    entry.cmd = renderCommandString(entry.executable);
  } else if (entry.cmd && !entry.executable) {
    entry.executable = parseCommandString(entry.cmd);
  }
  // Ensure executable has mandatory defaults regardless of source
  if (entry.executable) {
    if (entry.executable.expectedExitCode === undefined) entry.executable.expectedExitCode = 0;
    if (entry.executable.onFailure === undefined) entry.executable.onFailure = 'abort';
  }
  return entry;
}

function enrichCommandSet(set) {
  if (!set) return set;
  for (const phase of ['smoke', 'focused', 'full']) {
    if (Array.isArray(set[phase])) {
      set[phase] = set[phase].map(enrichCommandEntry);
    }
  }
  return set;
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
      smoke: [{ name: 'preview-docs', description: 'Start docs preview server', executable: { command: docsCommands.serve.split(/\s+/)[0], args: docsCommands.serve.split(/\s+/).slice(1) } }],
      focused: [{ name: 'build-docs', description: 'Build docs to catch broken pages', executable: { command: docsCommands.build.split(/\s+/)[0], args: docsCommands.build.split(/\s+/).slice(1) } }],
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
      const nodeDirectExec = buildNodeTestCommand(stack.node.testRunner, split.node, nodeExecConfig);
      addUniqueCommand(merged, 'focused', {
        name: 'node-direct-tests',
        description: 'Run node direct affected tests',
        executable: nodeDirectExec,
      });
    }

    if (split.python.length > 0 && stack.python?.enabled && stack.python.testRunner === 'pytest') {
      addUniqueCommand(merged, 'focused', {
        name: 'python-direct-tests',
        description: 'Run python direct affected tests',
        executable: { command: 'pytest', args: split.python },
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
            executable: { command: 'go', args: ['test', ...goPackages.map((p) => `./${p}`)] },
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
      let javaExec = null;
      const javaModules = stack.java.modules || stack.java.subprojects;
      if (stack.java.buildTool === 'maven') {
        const affectedModules = javaModules
          ? mapJavaFilesToModules(javaFiles, javaModules)
          : [];
        const mvn = stack.java.buildCommand || 'mvn';
        if (affectedModules.length > 0) {
          const plArg = affectedModules.join(',');
          javaExec = { command: mvn, args: ['-pl', plArg, '-am', '-q', '-Dtest=*Test', 'test'] };
        } else {
          javaExec = { command: mvn, args: ['-q', '-Dtest=*Test', 'test'] };
        }
      } else if (stack.java.buildTool === 'gradle') {
        const affectedModules = javaModules
          ? mapJavaFilesToModules(javaFiles, javaModules)
          : [];
        const gradle = stack.java.buildCommand || 'gradle';
        if (affectedModules.length > 0) {
          const testTasks = affectedModules.flatMap((m) => [`${m}:test`]);
          javaExec = { command: gradle, args: ['-q', ...testTasks, '--tests', '*Test'] };
        } else {
          javaExec = { command: gradle, args: ['-q', 'test', '--tests', '*Test'] };
        }
      }
      if (javaExec) {
        addUniqueCommand(merged, 'focused', {
          name: 'java-direct-tests',
          description: 'Run java direct affected tests',
          executable: javaExec,
        });
      }
    }
  }

  if (stack.profile === 'mixed') {
    if (!merged.full.some((entry) => entry.name === 'mixed-review')) {
      merged.full.unshift({
        name: 'mixed-review',
        description: 'Review all stack-side validation results together',
        executable: { command: 'echo', args: ['Review node/python/java/go/rust command output together before merge'] },
      });
    }
  }

  // Universal fallback: ensure at least one actionable command is always present
  const totalCommands = merged.smoke.length + merged.focused.length + merged.full.length;
  if (totalCommands === 0) {
    merged.smoke.push({
      name: 'git-diff-check',
      description: 'Check current changes for whitespace errors and basic issues',
      executable: { command: 'git', args: ['diff', '--check'] },
    });
    if (Array.isArray(targets) && targets.length > 0) {
      merged.smoke.push({
        name: 'git-diff-stat',
        description: 'Show change statistics for affected files',
        executable: { command: 'git', args: ['diff', '--stat', '--', ...targets] },
      });
    }
  }

  enrichCommandSet(merged);
  return merged;
}

module.exports = {
  generateCommands,
  inferRustModuleName,
  parseCommandString,
  renderCommandString,
  enrichCommandEntry,
  enrichCommandSet,
};
