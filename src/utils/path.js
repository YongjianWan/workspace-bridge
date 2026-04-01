/**
 * Path utilities for workspace-bridge
 */
const fs = require('fs');
const path = require('path');

const WORKSPACE_MARKERS = ['.git', 'package.json', 'pyproject.toml', 'requirements.txt', 'manage.py', 'pom.xml', 'build.gradle', 'build.gradle.kts'];

function normalizePath(inputPath) {
  if (!inputPath) return process.cwd();
  return path.resolve(inputPath);
}

function pathExists(targetPath) {
  try {
    fs.accessSync(targetPath);
    return true;
  } catch {
    return false;
  }
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function scoreDirectory(candidate) {
  let score = 0;
  if (pathExists(path.join(candidate, '.git'))) score += 10;
  if (pathExists(path.join(candidate, 'package.json'))) score += 6;
  if (pathExists(path.join(candidate, 'pyproject.toml'))) score += 6;
  if (pathExists(path.join(candidate, 'requirements.txt'))) score += 5;
  if (pathExists(path.join(candidate, 'manage.py'))) score += 5;
  if (pathExists(path.join(candidate, 'pom.xml'))) score += 6;
  if (pathExists(path.join(candidate, 'build.gradle')) || pathExists(path.join(candidate, 'build.gradle.kts'))) score += 6;
  return score;
}

function findNestedWorkspaceRoot(startPath) {
  const root = normalizePath(startPath);
  if (!pathExists(root) || !fs.statSync(root).isDirectory()) {
    return root;
  }

  let bestPath = root;
  let bestScore = scoreDirectory(root);

  let children = [];
  try {
    children = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return root;
  }

  for (const child of children) {
    if (!child.isDirectory() || child.name.startsWith('.')) continue;

    const candidate = path.join(root, child.name);
    const score = scoreDirectory(candidate);
    if (score > bestScore) {
      bestScore = score;
      bestPath = candidate;
    }
  }

  return bestPath;
}

function findWorkspaceRoot(startPath, options = {}) {
  // 1. 优先使用手动指定的工作区根目录（环境变量）
  const envWorkspaceRoot = process.env.WORKSPACE_ROOT;
  if (envWorkspaceRoot && pathExists(envWorkspaceRoot)) {
    return normalizePath(envWorkspaceRoot);
  }

  // 2. 优先使用参数指定的工作区根目录
  if (options.workspaceRoot && pathExists(options.workspaceRoot)) {
    return normalizePath(options.workspaceRoot);
  }

  // 3. 自动检测
  const originalStart = normalizePath(startPath);
  let current = normalizePath(startPath);
  
  if (!pathExists(current)) {
    current = process.cwd();
  }
  if (fs.existsSync(current) && fs.statSync(current).isFile()) {
    current = path.dirname(current);
  }

  while (true) {
    for (const marker of WORKSPACE_MARKERS) {
      if (pathExists(path.join(current, marker))) {
        const nestedCandidate = findNestedWorkspaceRoot(originalStart);
        return scoreDirectory(nestedCandidate) > scoreDirectory(current) ? nestedCandidate : current;
      }
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return findNestedWorkspaceRoot(normalizePath(startPath));
    }
    current = parent;
  }
}

function resolvePythonCommand(root) {
  const candidates = [
    path.join(root, '.venv', 'Scripts', 'python.exe'),
    path.join(root, 'venv', 'Scripts', 'python.exe'),
    path.join(root, '.venv', 'bin', 'python'),
    path.join(root, 'venv', 'bin', 'python'),
  ];

  for (const candidate of candidates) {
    if (pathExists(candidate)) {
      return `"${candidate}"`;
    }
  }
  return 'python';
}

function detectWorkspace(root) {
  const packageJsonPath = path.join(root, 'package.json');
  const pyprojectPath = path.join(root, 'pyproject.toml');
  const requirementsPath = path.join(root, 'requirements.txt');
  const managePyPath = path.join(root, 'manage.py');
  const tsconfigPath = path.join(root, 'tsconfig.json');
  const pomPath = path.join(root, 'pom.xml');
  const gradlePath = path.join(root, 'build.gradle');
  const gradleKtsPath = path.join(root, 'build.gradle.kts');
  const packageJson = pathExists(packageJsonPath) ? readJsonSafe(packageJsonPath) : null;

  return {
    root,
    hasGit: pathExists(path.join(root, '.git')),
    hasPackageJson: Boolean(packageJson),
    hasPyproject: pathExists(pyprojectPath),
    hasRequirements: pathExists(requirementsPath),
    hasManagePy: pathExists(managePyPath),
    hasTsconfig: pathExists(tsconfigPath),
    hasPom: pathExists(pomPath),
    hasGradle: pathExists(gradlePath) || pathExists(gradleKtsPath),
    hasJava: pathExists(pomPath) || pathExists(gradlePath) || pathExists(gradleKtsPath),
    packageJson,
  };
}

module.exports = {
  normalizePath,
  pathExists,
  readJsonSafe,
  scoreDirectory,
  findWorkspaceRoot,
  resolvePythonCommand,
  detectWorkspace,
  WORKSPACE_MARKERS,
};
