/**
 * Path utilities for workspace-bridge
 */
const fs = require('fs');
const path = require('path');

const WORKSPACE_MARKERS = ['.git', 'package.json', 'pyproject.toml', 'requirements.txt', 'manage.py', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'go.mod', 'Cargo.toml'];
const IS_WINDOWS = process.platform === 'win32';

function normalizePath(inputPath) {
  if (!inputPath) return process.cwd();
  return path.resolve(inputPath);
}

function toPosixPath(inputPath) {
  return String(inputPath || '').replace(/\\/g, '/');
}

function normalizePathKey(inputPath) {
  const absolute = normalizePath(inputPath);
  const normalized = toPosixPath(path.normalize(absolute));
  return IS_WINDOWS ? normalized.toLocaleLowerCase('en-US') : normalized;
}

function toRelativePosix(rootPath, targetPath) {
  const root = normalizePath(rootPath);
  const target = normalizePath(targetPath);
  return toPosixPath(path.relative(root, target));
}

function isPathInsideRoot(rootPath, targetPath) {
  const root = normalizePath(rootPath);
  const target = normalizePath(targetPath);
  const relative = path.relative(root, target);
  if (!relative) return true;
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

function hasPathSegment(targetPath, segment) {
  const normalizedPath = normalizePathKey(targetPath);
  const normalizedSegment = normalizePathKey(segment);
  if (!normalizedSegment) return false;
  const pathParts = normalizedPath.split('/').filter(Boolean);
  const segmentParts = normalizedSegment.split('/').filter(Boolean);
  return segmentParts.some((part) => pathParts.includes(part));
}

function matchesPathFragment(targetPath, fragment) {
  const normalizedPath = normalizePathKey(targetPath);
  const normalizedFragment = toPosixPath(String(fragment || '')).replace(/^\.?\//, '').replace(/\/+$/, '');
  if (!normalizedFragment) return false;
  const key = IS_WINDOWS ? normalizedFragment.toLocaleLowerCase('en-US') : normalizedFragment;
  return normalizedPath.includes(`/${key}/`) || normalizedPath.endsWith(`/${key}`);
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

const WORKSPACE_SCORE_RULES = [
  { files: ['.git'], score: 10 },
  { files: ['package.json'], score: 6 },
  { files: ['pyproject.toml'], score: 6 },
  { files: ['requirements.txt'], score: 5 },
  { files: ['manage.py'], score: 5 },
  { files: ['pom.xml'], score: 6 },
  { files: ['build.gradle', 'build.gradle.kts'], score: 6 },
  { files: ['go.mod'], score: 6 },
  { files: ['Cargo.toml'], score: 6 },
];

function scoreDirectory(candidate) {
  let score = 0;
  for (const rule of WORKSPACE_SCORE_RULES) {
    if (rule.files.some((f) => pathExists(path.join(candidate, f)))) score += rule.score;
  }
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
    'python3',
    'python',
  ];

  for (const candidate of candidates) {
    if (pathExists(candidate)) {
      return candidate;
    }
  }
  return 'python';
}

function resolveWorkspaceFilePath(filePath, root) {
  if (!filePath || typeof filePath !== 'string') return null;
  const resolved = path.isAbsolute(filePath)
    ? normalizePath(filePath)
    : normalizePath(path.join(root, filePath));
  if (!isPathInsideRoot(root, resolved)) {
    return null;
  }
  return resolved;
}

function isStandaloneEntryPath(relativePath) {
  if (!relativePath) return false;
  return (
    relativePath.startsWith('scripts/') || relativePath.includes('/scripts/') ||
    relativePath.startsWith('bin/') || relativePath.includes('/bin/') ||
    relativePath.startsWith('benchmark/') || relativePath.includes('/benchmark/')
  );
}

function _hasJavaInSubdirs(root) {
  if (pathExists(path.join(root, 'pom.xml')) || pathExists(path.join(root, 'build.gradle')) || pathExists(path.join(root, 'build.gradle.kts'))) {
    return true;
  }
  try {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const sub = path.join(root, entry.name);
      if (pathExists(path.join(sub, 'pom.xml')) || pathExists(path.join(sub, 'build.gradle')) || pathExists(path.join(sub, 'build.gradle.kts'))) {
        return true;
      }
    }
  } catch { /* ignore */ }
  return false;
}

function _hasPythonFiles(root) {
  try {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        if (entry.name.endsWith('.py')) return true;
        continue;
      }
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const sub = path.join(root, entry.name);
      for (const subEntry of fs.readdirSync(sub, { withFileTypes: true })) {
        if (!subEntry.isDirectory() && subEntry.name.endsWith('.py')) return true;
      }
    }
  } catch { /* ignore */ }
  return false;
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
  const goModPath = path.join(root, 'go.mod');
  const cargoPath = path.join(root, 'Cargo.toml');
  const cmakePath = path.join(root, 'CMakeLists.txt');
  const makePath = path.join(root, 'Makefile');
  const packageJson = pathExists(packageJsonPath) ? readJsonSafe(packageJsonPath) : null;

  return {
    root,
    hasGit: pathExists(path.join(root, '.git')),
    hasPackageJson: Boolean(packageJson),
    hasPyproject: pathExists(pyprojectPath),
    hasRequirements: pathExists(requirementsPath),
    hasManagePy: pathExists(managePyPath),
    hasPythonFiles: _hasPythonFiles(root),
    hasTsconfig: pathExists(tsconfigPath),
    hasPom: pathExists(pomPath),
    hasGradle: pathExists(gradlePath) || pathExists(gradleKtsPath),
    hasJava: _hasJavaInSubdirs(root),
    hasGo: pathExists(goModPath),
    hasRust: pathExists(cargoPath),
    hasCpp: pathExists(cmakePath) || pathExists(makePath),
    packageJson,
  };
}

module.exports = {
  normalizePath,
  normalizePathKey,
  toPosixPath,
  toRelativePosix,
  isPathInsideRoot,
  hasPathSegment,
  matchesPathFragment,
  pathExists,
  readJsonSafe,
  scoreDirectory,
  findWorkspaceRoot,
  resolvePythonCommand,
  detectWorkspace,
  resolveWorkspaceFilePath,
  isStandaloneEntryPath,
  WORKSPACE_MARKERS,
};
