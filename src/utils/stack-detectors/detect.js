/**
 * Stack detection logic — detect project tech stack from filesystem markers.
 */
const fs = require('fs');
const path = require('path');
const { pathExists, readJsonSafe } = require('../path');

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

function hasCppProject(root) {
  const markers = ['CMakeLists.txt', 'Makefile', 'makefile'];
  return markers.some((f) => pathExists(path.join(root, f)));
}

function hasGoProject(root) {
  return detectGoModules(root) !== null;
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

function detectNodeFramework(root) {
  const packageJsonPath = path.join(root, 'package.json');
  if (!pathExists(packageJsonPath)) return null;
  const pkg = readJsonSafe(packageJsonPath);
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  if (deps.next || deps['next-router-mock']) return 'next';
  if (deps.nuxt || deps['nuxt-kit']) return 'nuxt';
  if (deps.vue || deps['vue-router'] || deps.vuex || deps.pinia) return 'vue';
  if (deps.react || deps['react-dom'] || deps['react-router-dom']) return 'react';
  if (deps.svelte || deps['@sveltejs/kit']) return 'svelte';
  if (deps['@angular/core'] || deps['@angular/cli']) return 'angular';
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
  const re = new RegExp(`\\b${pluginName}\\b`);
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;
    if (re.test(trimmed)) return true;
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
  const hasCpp = hasCppProject(root);
  const goModules = hasGo ? detectGoModules(root) : null;
  const nodePackageManager = detectNodePackageManager(root);
  const nodeFramework = detectNodeFramework(root);
  const javaBuildTool = detectJavaBuildTool(root);
  const javaBuildCommand = detectJavaBuildCommand(root, javaBuildTool);
  const javaSubprojects = javaBuildTool === 'gradle' ? detectGradleSubprojects(root) : null;
  const testRunner = detectTestRunner(root);
  const pythonTestRunner = detectPythonTestRunner(root, pyprojectText);
  const linters = detectLinters(root, pyprojectText);
  const typeCheckers = detectTypeCheckers(root, pyprojectText);

  let profile = 'unknown';
  const activeStacks = [hasNode, hasPython, hasJava, hasGo, hasRust, hasCpp].filter(Boolean).length;
  if (activeStacks >= 2) profile = 'mixed';
  else if (hasNode) profile = 'node-first';
  else if (hasPython) profile = 'python-first';
  else if (hasJava) profile = 'java-first';
  else if (hasGo) profile = 'go-first';
  else if (hasRust) profile = 'rust-first';
  else if (hasCpp) profile = 'cpp-first';

  return {
    profile,
    packageManager: hasNode ? nodePackageManager : hasPython ? 'pip' : hasJava ? javaBuildTool : null,
    docsTool: detectDocsTool(root),
    node: hasNode ? {
      enabled: true,
      packageManager: nodePackageManager,
      framework: nodeFramework,
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
    cpp: hasCpp ? { enabled: true, packageManager: 'cmake/make', testRunner: 'ctest' } : null,
  };
}

module.exports = {
  detectStack,
  detectNodePackageManager,
  detectTestRunner,
  mapFileToGoModule,
  detectGoModules,
  detectRustWorkspaceMembers,
  detectJavaBuildTool,
  detectGradleSubprojects,
  detectJavaBuildCommand,
  detectPythonTestRunner,
  detectPythonFramework,
  detectLinters,
  detectTypeCheckers,
  detectDocsTool,
  readTextIfExists,
  hasCppProject,
};
