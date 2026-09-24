/**
 * Path utilities for workspace-bridge
 */
const fs = require('fs');
const path = require('path');

const WORKSPACE_MARKERS = ['.git', 'package.json', 'pyproject.toml', 'requirements.txt', 'manage.py', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'go.mod', 'Cargo.toml'];
const IS_WINDOWS = process.platform === 'win32';

function normalizePath(inputPath) {
  if (!inputPath) return process.cwd();
  const posix = String(inputPath).replace(/\\/g, '/');
  return path.resolve(posix);
}

function toPosixPath(inputPath) {
  return String(inputPath || '').replace(/\\/g, '/');
}

function normalizePathKey(inputPath) {
  const absolute = normalizePath(inputPath);
  const normalized = toPosixPath(path.normalize(absolute));
  return IS_WINDOWS ? normalized.toLocaleLowerCase('en-US') : normalized;
}

/**
 * Normalize a file path into a stable key used for graph/cache lookups.
 * Handles relative paths by resolving them against workspaceRoot first.
 * Returns null for non-string inputs.
 */
function normalizeFilePath(filePath, workspaceRoot) {
  if (!filePath || typeof filePath !== 'string') return null;
  const absolute = path.isAbsolute(filePath)
    ? filePath
    : path.join(workspaceRoot || process.cwd(), filePath);
  return normalizePathKey(absolute);
}

/**
 * Convert a path to a display-friendly form: absolute, POSIX slashes,
 * but preserving original casing. Used for JSON output so that
 * `filePreview.js` does not become `filepreview.js` on Windows.
 * Internal matching should still use `normalizePathKey`.
 */
function toDisplayPath(inputPath) {
  const absolute = normalizePath(inputPath);
  return toPosixPath(path.normalize(absolute));
}

/**
 * Convert a normalized path key back to a platform-native path.
 * On Windows, this restores backslash separators (original casing is lost
 * during normalization). On POSIX, this is a no-op.
 *
 * Use this when feeding a normalized key to fs/path APIs that expect
 * platform-native paths, eliminating the implicit assumption that POSIX-style
 * keys are universally accepted.
 */
function fromNormalizedKey(key) {
  if (!key || !IS_WINDOWS) return key;
  return key.replace(/\//g, '\\');
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

function matchesPathFragment(targetPath, fragment) {
  let normalizedPath = String(targetPath || '');
  if (normalizedPath.includes('\\')) {
    normalizedPath = normalizedPath.replace(/\\/g, '/');
  }
  if (!normalizedPath.startsWith('/')) {
    normalizedPath = '/' + normalizedPath;
  }
  if (IS_WINDOWS) {
    normalizedPath = normalizedPath.toLocaleLowerCase('en-US');
  }
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
    const { stripBOM } = require('./sanitize');
    return JSON.parse(stripBOM(fs.readFileSync(filePath, 'utf8')));
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

  let children;
  try {
    children = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return root;
  }

  for (const child of children) {
    if (!child.isDirectory() || child.name.startsWith('.')) continue;
    // 依赖噪音不是工作区：node_modules 里的包各个带 package.json，
    // 挑战者扫描不得把根吸进依赖树（L2-23 同族防线）。
    if (child.name === 'node_modules') continue;

    const candidate = path.join(root, child.name);
    const score = scoreDirectory(candidate);
    if (score > bestScore) {
      bestScore = score;
      bestPath = candidate;
    }
  }

  return bestPath;
}

/**
 * 工作区定根（L2-23 语义）：**攀爬最多到自己仓库的 git 根，仓外不爬**。
 *
 * 旧语义逐级上爬直到命中任何 WORKSPACE_MARKERS——家目录/Temp 层恰好躺着一个
 * 工具残留的 `package.json` 时，任何无标记 scratch 目录都会被吞成主目录级别的
 * 巨型根（init 变成索引半个硬盘，与挂死无法区分；2026-09-24 实测烧掉两小时）。
 * 现在信任边界是显式的：git 根是项目边界（`.git` 本身在标记清单里，攀到即命中）；
 * 完全在 git 仓之外的目录，给什么认什么——「你让我分析这个目录，我就分析这个目录」。
 * 有意的行为变化：仓外非 git 项目的子目录不再上爬到带 manifest 的父级，
 * 根就是所给目录（2026-09-24 拍板，方案②）。
 */
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

  // 3. 自动检测：先归一化入口（文件取所在目录；起点不存在退回 cwd）。
  let current = normalizePath(startPath);
  if (!pathExists(current)) {
    current = process.cwd();
  }
  if (fs.existsSync(current) && fs.statSync(current).isFile()) {
    current = path.dirname(current);
  }

  // 攀爬天花板 = 最近的含 `.git` 祖先（含自身）。找不到 → 仓外，不爬。
  let ceiling = null;
  for (let dir = current; ; dir = path.dirname(dir)) {
    if (pathExists(path.join(dir, '.git'))) {
      ceiling = dir;
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
  }
  if (ceiling === null) {
    return findNestedWorkspaceRoot(current);
  }

  // start → git 根之间第一个带标记的目录胜出（`.git` 在 WORKSPACE_MARKERS 里，
  // git 根必然命中）；findNestedWorkspaceRoot 挑战者语义照旧。
  for (let dir = current; ; dir = path.dirname(dir)) {
    for (const marker of WORKSPACE_MARKERS) {
      if (pathExists(path.join(dir, marker))) {
        const nestedCandidate = findNestedWorkspaceRoot(current);
        return scoreDirectory(nestedCandidate) > scoreDirectory(dir) ? nestedCandidate : dir;
      }
    }
    if (dir === ceiling) break;
  }
  // 语义兜底（非防御）：范围内无标记目录的唯一形状（仅当 WORKSPACE_MARKERS
  // 将来不再含 `.git` 时可达）——与仓外分支同语义，认 start 自己。
  return findNestedWorkspaceRoot(current);
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
  const trimmed = filePath.trim().replace(/\\/g, '/');
  // On Windows, a leading slash looks relative to path.join but actually
  // denotes an absolute POSIX-style path — treat it as an escape attempt.
  if (IS_WINDOWS && /^[\\/]/.test(trimmed)) return null;
  const resolved = path.isAbsolute(trimmed)
    ? normalizePath(trimmed)
    : normalizePath(path.join(root, trimmed));
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
    relativePath.startsWith('benchmark/') || relativePath.includes('/benchmark/') ||
    // P100: root-level Python files are standalone entry points (not orphans)
    /^[^/]+\.py$/.test(relativePath)
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

const CPP_FILE_EXTENSIONS = new Set(['.c', '.cpp', '.cc', '.cxx', '.h', '.hpp']);

function _hasCppFiles(root) {
  try {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (CPP_FILE_EXTENSIONS.has(ext)) return true;
        continue;
      }
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'vendor' || entry.name === 'build' || entry.name === 'dist') continue;
      const sub = path.join(root, entry.name);
      for (const subEntry of fs.readdirSync(sub, { withFileTypes: true })) {
        if (!subEntry.isDirectory()) {
          const ext = path.extname(subEntry.name).toLowerCase();
          if (CPP_FILE_EXTENSIONS.has(ext)) return true;
        }
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
    hasCpp: pathExists(cmakePath) || pathExists(makePath) || _hasCppFiles(root),
    packageJson,
  };
}

function get2LevelPrefix(relPath) {
  if (!relPath || typeof relPath !== 'string') return '.';
  const normalized = relPath.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  // Exclude filename — we want directory prefixes only
  const dirParts = parts.slice(0, -1);
  if (dirParts.length >= 2) {
    return dirParts.slice(0, 2).join('/');
  } else if (dirParts.length === 1) {
    return dirParts[0];
  }
  return '.';
}

module.exports = {
  normalizePath,
  normalizePathKey,
  normalizeFilePath,
  fromNormalizedKey,
  toPosixPath,
  toDisplayPath,
  toRelativePosix,
  isPathInsideRoot,
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
  get2LevelPrefix,
};
